import os
import pty
import asyncio
import subprocess
import shutil
import zipfile
import signal
import json
import fcntl
import termios
import struct
import uuid
from pathlib import Path
from typing import List, Optional
from fastapi import FastAPI, WebSocket, UploadFile, File, BackgroundTasks, Form, HTTPException, WebSocketDisconnect
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn

app = FastAPI()
ROOT_DIR = Path(".").resolve()

tasks_state = {}
terminals = {}


class RenameModel(BaseModel):
    old_name: str
    new_name: str


class RenameTerminalModel(BaseModel):
    name: str


class CreateModel(BaseModel):
    name: str


class TerminalSession:
    def __init__(self, id, name, master, proc, buffer, sockets):
        self.id = id
        self.name = name
        self.master = master
        self.proc = proc
        self.buffer = buffer
        self.sockets = sockets


def secure_path(path_str: str) -> Path:
    target = (ROOT_DIR / path_str.strip("/")).resolve()
    if not target.is_relative_to(ROOT_DIR):
        raise HTTPException(status_code=403, detail="Access denied")
    return target


def cleanup_terminal(term_id: str):
    term: TerminalSession = terminals.pop(term_id, None)
    if not term:
        return

    loop = asyncio.get_running_loop()
    try:
        loop.remove_reader(term.master)
    except Exception:
        pass

    try:
        os.killpg(os.getpgid(term.proc.pid), signal.SIGKILL)
    except Exception:
        pass

    try:
        loop.run_in_executor(None, term.proc.wait)
    except Exception:
        pass

    try:
        os.close(term.master)
    except Exception:
        pass

    for ws in term.sockets:
        asyncio.create_task(ws.close())


def create_terminal(name: str):
    term_id = str(uuid.uuid4())
    master, slave = pty.openpty()
    env = os.environ.copy()
    env["PS1"] = r"[\u@ \W]\$ "
    env["TERM"] = "xterm-256color"
    env["COLUMNS"] = "120"
    env["LINES"] = "30"

    flags = fcntl.fcntl(master, fcntl.F_GETFL)
    fcntl.fcntl(master, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    proc = subprocess.Popen(
        ["bash", "--norc", "-i"],
        stdin=slave, stdout=slave, stderr=slave,
        env=env, preexec_fn=os.setsid
    )
    os.close(slave)

    terminals[term_id] = TerminalSession(term_id, name, master, proc, b"", [])

    loop = asyncio.get_running_loop()

    def pty_read_cb():
        term: TerminalSession = terminals.get(term_id)
        if not term:
            return
        try:
            data = os.read(master, 4096)
            if data:
                term.buffer = (term.buffer + data)[-10000:]
                for ws in term.sockets:
                    asyncio.create_task(ws.send_text(
                        data.decode('utf-8', errors='replace')))
            else:
                cleanup_terminal(term_id)
        except OSError:
            cleanup_terminal(term_id)

    loop.add_reader(master, pty_read_cb)
    return term_id


@app.get("/")
async def root():
    with open("static/index.html", "r") as f:
        return HTMLResponse(content=f.read())

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/api/files")
async def list_files(path: str = ""):
    target = secure_path(path)
    if not target.is_dir():
        return []
    result = []
    for entry in target.iterdir():
        result.append({
            "name": entry.name,
            "is_dir": entry.is_dir(),
            "size": entry.stat().st_size if entry.is_file() else 0
        })
    return sorted(result, key=lambda x: (not x["is_dir"], x["name"]))


@app.post("/api/files")
async def create_file(path: str, data: CreateModel):
    target = secure_path(path) / data.name
    target.touch(exist_ok=True)
    return {"status": "ok"}


@app.put("/api/files")
async def rename_file(path: str, data: RenameModel):
    dir_target = secure_path(path)
    if (not dir_target.exists()):
        raise HTTPException(status_code=404, detail="Item not found")
    (dir_target / data.old_name).rename(dir_target / data.new_name)
    return {"status": "ok"}


@app.delete("/api/files")
async def delete_file(path: str, name: str):
    target = secure_path(path) / name
    if target.exists():
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
    else:
        raise HTTPException(status_code=404, detail="File not found")
    return {"status": "ok"}


@app.post("/api/upload")
async def upload_files(path: str = Form(...), files: List[UploadFile] = File(...)):
    target_dir = secure_path(path)
    for file in files:
        file_path = target_dir / file.filename
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    return {"status": "ok"}


def build_zip(target_path: Path, task_id: str):
    zip_name = f"/tmp/{task_id}.zip"
    tasks_state[task_id] = {"progress": 0,
                            "status": "processing", "file": zip_name}
    total_files = sum(len(files) for _, _, files in os.walk(target_path))
    processed = 0
    with zipfile.ZipFile(zip_name, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, _, files in os.walk(target_path):
            for file in files:
                file_path = Path(root) / file
                zipf.write(file_path, file_path.relative_to(
                    target_path.parent))
                processed += 1
                tasks_state[task_id]["progress"] = int(
                    (processed / total_files) * 100) if total_files > 0 else 100
    tasks_state[task_id]["status"] = "done"


@app.post("/api/download/folder")
async def request_folder_download(path: str, name: str, background_tasks: BackgroundTasks):
    target = secure_path(path) / name
    if not target.exists() or not target.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")
    task_id = os.urandom(8).hex()
    background_tasks.add_task(build_zip, target, task_id)
    return {"task_id": task_id}


@app.get("/api/download/progress/{task_id}")
async def get_progress(task_id: str):
    return tasks_state.get(task_id, {"status": "not_found"})


@app.get("/api/download/file")
async def download_file(path: str, name: str, task_id: Optional[str] = None):
    if task_id:
        file_path = tasks_state[task_id]["file"]
        return FileResponse(file_path, filename=f"{name}.zip")
    target = secure_path(path) / name
    if not target.exists():
        return HTTPException(status_code=404, detail="File not found")
    return FileResponse(target, filename=name)


@app.websocket("/ws/terminal/{term_id}")
async def terminal_socket(websocket: WebSocket, term_id: str):
    await websocket.accept()
    term: TerminalSession = terminals.get(term_id)

    if not term:
        await websocket.close()
        return

    term.sockets.append(websocket)

    if term.buffer:
        await websocket.send_text(term.buffer.decode('utf-8', errors='replace'))

    try:
        while True:
            msg = await websocket.receive_text()
            try:
                payload = json.loads(msg)
                if payload.get("type") == "data":
                    os.write(term.master, payload["data"].encode('utf-8'))
                elif payload.get("type") == "resize":
                    winsize = struct.pack(
                        "HHHH", payload["rows"], payload["cols"], 0, 0)
                    fcntl.ioctl(term.master, termios.TIOCSWINSZ, winsize)
            except json.JSONDecodeError:
                os.write(term.master, msg.encode('utf-8'))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if websocket in term.sockets:
            term.sockets.remove(websocket)


@app.post("/api/terminals")
async def api_create_terminal(data: CreateModel):
    term_id = create_terminal(data.name)
    return {"id": term_id, "name": data.name}


@app.get("/api/terminals")
async def api_list_terminals():
    return [{"id": t.id, "name": t.name} for t in terminals.values()]


@app.delete("/api/terminals/{term_id}")
async def api_delete_terminal(term_id: str):
    cleanup_terminal(term_id)
    return {"status": "ok"}


@app.put("/api/terminals/{term_id}")
async def api_rename_terminal(term_id: str, data: RenameTerminalModel):
    if term_id not in terminals:
        raise HTTPException(status_code=404, detail="Terminal not found")

    terminals[term_id].name = data.name

    return {"status": "ok", "new_name": data.name}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
