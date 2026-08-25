tabs = {}
activeTabId = null
tabCounter = 1

currentPath = "/"
historyBack = []
historyForward = []

const terminalsTab = document.getElementById("terminals-tab")
const filebrowserTab = document.getElementById("filebrowser-tab")
const btnFilebrowserCollapse = document.getElementById(
    "btn-filebrowser-collapse",
)

const btnBack = document.getElementById("btn-back")
const btnForward = document.getElementById("btn-forward")
const currentPathText = document.getElementById("current-path-display")
const fileInput = document.getElementById("file-upload-input")
const folderInput = document.getElementById("folder-upload-input")
const btnRefresh = document.getElementById("btn-refresh")

async function init() {
    assignEvents()
    const configRes = await fetch("/api/config")
    const config = await configRes.json()

    if (config.filebrowser_only) {
        toggleCollapsed(terminalsTab)
        btnFilebrowserCollapse.disabled = true
    } else {
        await getTerminals()
    }
    loadFiles()
}

function assignEvents() {
    document
        .getElementById("create-file-item")
        .addEventListener("click", () => createFileOrFolderPrompt(false))
    document
        .getElementById("create-folder-item")
        .addEventListener("click", () => createFileOrFolderPrompt(true))
    document
        .getElementById("file-upload-input")
        .addEventListener("change", handleUpload)
    document
        .getElementById("folder-upload-input")
        .addEventListener("change", handleUpload)

    document
        .getElementById("btn-terminals-collapse")
        .addEventListener("click", collapseTerminals)

    btnFilebrowserCollapse.addEventListener("click", collapseFilebrowser)

    document.getElementById("addTabButton").addEventListener("click", addTab)
    document.getElementById("btn-back").addEventListener("click", goBack)
    document.getElementById("btn-forward").addEventListener("click", goForward)
    document
        .getElementById("file-upload-item")
        .addEventListener("click", () => fileInput.click())
    document
        .getElementById("folder-upload-item")
        .addEventListener("click", () => folderInput.click())

    btnRefresh.addEventListener("click", loadFiles)

    const dropZone = document.getElementById("drop-zone")
    let dragCounter = 0

    ;["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
        dropZone.addEventListener(
            eventName,
            (e) => {
                e.preventDefault()
                e.stopPropagation()
            },
            false,
        )
    })

    dropZone.addEventListener("dragenter", (e) => {
        dragCounter++
        if (dragCounter === 1) {
            dropZone.classList.add("drag-over")
        }
    })

    dropZone.addEventListener("dragleave", (e) => {
        dragCounter--
        if (dragCounter === 0) {
            dropZone.classList.remove("drag-over")
        }
    })

    dropZone.addEventListener("drop", (e) => {
        dragCounter = 0
        dropZone.classList.remove("drag-over")
        handleDrop(e)
    })
}

async function getTerminals() {
    window.addEventListener("resize", () => {
        if (activeTabId && tabs[activeTabId]) {
            tabs[activeTabId].fitAddon.fit()
        }
    })
    try {
        const res = await fetch("/api/terminals")
        if (!res.ok) {
            throw new Error(`Server returned status: ${res.status}`)
        }
        const activeTerminals = await res.json()

        if (activeTerminals.length > 0) {
            tabCounter = activeTerminals.length + 1
            for (const t of activeTerminals) {
                await addTab(t.id, t.name)
            }
        } else {
            await addTab()
        }
    } catch (err) {
        console.error("Failed to load active terminals:", err)
        showToast("Error connecting to server")
        await addTab()
    }
}

function showToast(msg) {
    document.getElementById("toast-message").innerText = msg
    const toast = bootstrap.Toast.getOrCreateInstance(
        document.getElementById("status-toast"),
    )
    if (!toast.isShown()) toast.show()
}

function toggleCollapsed(tab) {
    tab.classList.toggle("d-flex")
    tab.classList.toggle("d-none")
    resizeTerminal()
}

function isCollapsed(tab) {
    return tab.classList.contains("d-none")
}

function animatePanel(tab, animationName, cb) {
    tab.addEventListener(
        "animationend",
        () => {
            if (cb) cb()
            tab.classList.remove(animationName)
        },
        { once: true },
    )
    tab.classList.add(animationName)
}

function collapseTerminals() {
    if (isCollapsed(filebrowserTab)) {
        toggleCollapsed(filebrowserTab)
        animatePanel(filebrowserTab, "slide-in-right")
    } else if (!isCollapsed(terminalsTab)) {
        animatePanel(terminalsTab, "slide-out-left", () => {
            toggleCollapsed(terminalsTab)
        })
    }
}

function collapseFilebrowser() {
    if (isCollapsed(terminalsTab)) {
        toggleCollapsed(terminalsTab)
        animatePanel(terminalsTab, "slide-in-left")
    } else if (!isCollapsed(filebrowserTab)) {
        animatePanel(filebrowserTab, "slide-out-right", () => {
            toggleCollapsed(filebrowserTab)
        })
    }
}

async function addTab(existingId = null, existingName = null) {
    let id, name
    if (existingId && existingName) {
        id = existingId
        name = existingName
    } else {
        name = `Terminal ${tabCounter++}`
        try {
            const res = await fetch("/api/terminals", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name }),
            })
            if (!res.ok) {
                throw new Error(`Server returned status: ${res.status}`)
            }
            const data = await res.json()
            id = data.id
        } catch (err) {
            console.error("Failed to create new terminal:", err)
            showToast("Error creating terminal")
            tabCounter--
            return
        }
    }

    const tabEl = document.createElement("li")
    tabEl.className = "nav-item"
    tabEl.innerHTML = `
        <button type="button" class="nav-link user-select-none" id="${id}-link">
            <span class="text-nowrap" id="${id}-name">${name}</span>
            <i class="bi bi-pencil ms-1 tab-edit-btn" style="font-size: 0.7rem; cursor: pointer;"></i>
            <i class="bi bi-x-lg ms-2 text-danger tab-close-btn" style="font-size: 0.8rem; cursor: pointer;"></i>
        </button>
    `
    document.getElementById("tabs-container").appendChild(tabEl)

    document.getElementById(`${id}-link`).addEventListener("click", (e) => {
        switchTab(id)
    })

    document.getElementById(`${id}-name`).addEventListener("dblclick", () => {
        editTabName(id)
    })

    tabEl.querySelector(".tab-edit-btn").addEventListener("click", (e) => {
        e.stopPropagation()
        editTabName(id)
    })

    tabEl.querySelector(".tab-close-btn").addEventListener("click", (e) => {
        e.stopPropagation()
        closeTab(id)
    })

    const termWrapper = document.createElement("div")
    termWrapper.className = "terminal-wrapper"
    termWrapper.id = `${id}-wrapper`
    document.getElementById("terminals-container").appendChild(termWrapper)

    const term = new Terminal({
        theme: { background: "#212529" },
        convertEol: true,
        cursorBlink: true,
        rows: 24,
        cols: 80,
    })
    const fitAddon = new FitAddon.FitAddon()
    term.loadAddon(fitAddon)
    term.open(termWrapper)

    term.attachCustomKeyEventHandler((e) => {
        // Intercept Ctrl + Shift + C
        if (e.ctrlKey && e.shiftKey && e.code === "KeyC") {
            if (e.type === "keydown") {
                e.preventDefault()
                const selection = term.getSelection()
                if (selection) {
                    navigator.clipboard.writeText(selection).catch((err) => {
                        console.error("Failed to copy text:", err)
                    })
                }
            }
            return false // Tell xterm.js the event is handled
        }
        return true
    })

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const ws = new WebSocket(
        `${protocol}//${window.location.host}/ws/terminal/${id}`,
    )

    ws.onmessage = (e) => term.write(e.data)
    term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "data", data: data }))
        }
    })

    term.onResize((size) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(
                JSON.stringify({
                    type: "resize",
                    cols: size.cols,
                    rows: size.rows,
                }),
            )
        }
    })

    tabs[id] = { term, fitAddon, ws, tabEl, termWrapper }
    switchTab(id)

    setTimeout(() => fitAddon.fit(), 100)
}

function switchTab(id) {
    if (activeTabId && tabs[activeTabId]) {
        tabs[activeTabId].tabEl
            .querySelector(".nav-link")
            .classList.remove("active")
        tabs[activeTabId].termWrapper.classList.remove("active")
    }
    activeTabId = id

    tabs[id].tabEl.querySelector(".nav-link").classList.add("active")
    tabs[id].termWrapper.classList.add("active")
    tabs[id].fitAddon.fit()
    tabs[id].term.focus()
}

function closeTab(id) {
    const name = document.getElementById(`${id}-name`).innerText

    const modalEl = document.getElementById("confirm-close-modal")
    const textEl = document.getElementById("confirm-close-text")
    const btnConfirm = document.getElementById("confirm-close-btn")

    textEl.innerText = `Are you sure you want to close terminal window '${name}'? This will interrupt any commands in progress.`

    const modal = new bootstrap.Modal(modalEl)
    modal.show()

    btnConfirm.onclick = async () => {
        btnConfirm.disabled = true
        btnConfirm.innerText = "Closing..."

        try {
            const res = await fetch(`/api/terminals/${id}`, {
                method: "DELETE",
            })
            if (!res.ok) {
                throw new Error(`Server returned status: ${res.status}`)
            }

            const tab = tabs[id]
            tab.ws.close()
            tab.term.dispose()
            tab.tabEl.remove()
            tab.termWrapper.remove()
            delete tabs[id]

            if (activeTabId === id) {
                const remaining = Object.keys(tabs)
                if (remaining.length > 0) {
                    switchTab(remaining[remaining.length - 1])
                } else {
                    activeTabId = null
                }
            }
            tabCounter--
            modal.hide()
        } catch (err) {
            console.error("Failed to close terminal:", err)
            showToast("Error closing terminal")
        } finally {
            btnConfirm.disabled = false
            btnConfirm.innerText = "Close Terminal"
        }
    }
}

function editTabName(id) {
    const span = document.getElementById(`${id}-name`)
    const currentName = span.innerText

    const input = document.createElement("input")
    input.type = "text"
    input.id = `${id}-input`
    input.value = currentName

    input.addEventListener("click", (e) => {
        e.stopPropagation()
    })

    span.replaceWith(input)

    input.focus()
    input.select()

    let isFinished = false

    const finish = async (save) => {
        if (isFinished) return
        isFinished = true

        let finalName = currentName
        const inputValue = input.value.trim()

        if (save && inputValue !== "" && inputValue !== currentName) {
            finalName = inputValue

            try {
                const res = await fetch(`/api/terminals/${id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: finalName }),
                })
                if (!res.ok) {
                    throw new Error(`Server returned status: ${res.status}`)
                }
            } catch (err) {
                console.error("Failed to rename terminal on server:", err)
                showToast("Error renaming terminal")
                finalName = currentName
            }
        }

        const newSpan = document.createElement("span")
        newSpan.className = "text-nowrap"
        newSpan.id = `${id}-name`
        newSpan.innerText = finalName

        newSpan.addEventListener("dblclick", () => {
            editTabName(id)
        })

        input.replaceWith(newSpan)
    }

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            finish(true)
        }
        if (e.key === "Escape") {
            finish(false)
        }
    })
    input.addEventListener("blur", () => finish(true))
}

async function loadFiles() {
    try {
        btnRefresh.innerHTML = `<i class="bi bi-x"></i>`
        btnRefresh.disabled = true
        const res = await fetch(
            `/api/files?path=${encodeURIComponent(currentPath)}`,
        )
        if (!res.ok) {
            throw new Error(`Server returned status: ${res.status}`)
        }
        const files = await res.json()
        const list = document.getElementById("file-list")
        list.innerHTML = ""

        files.forEach((f) => {
            const icon = f.is_dir
                ? "bi-folder-fill text-warning"
                : "bi-file-earmark-text text-light"
            const li = document.createElement("li")
            li.className =
                "list-group-item file-item d-flex justify-content-between align-items-center"
            li.innerHTML = `
            <div class="d-flex align-items-center gap-2 overflow-hidden" style="width: 80%;">
                <i class="bi ${icon}"></i>
                <span class="text-truncate file-name-span">${f.name}</span>
            </div>
            <div class="dropdown file-actions">
                <button class="btn btn-sm btn-link text-light p-0 border-0" data-bs-toggle="dropdown"><i class="bi bi-three-dots"></i></button>
                <ul class="dropdown-menu dropdown-menu-dark dropdown-menu-end shadow px-2">
                    <li><button type="button" class="dropdown-item rename-btn mb-2">Rename</button></li>
                    <li><button type="button" class="dropdown-item download-btn">Download</button></li>
                    <li><hr class="dropdown-divider border-light-semitransparent"></li>
                    <li><button type="button" class="dropdown-item text-danger delete-btn">Delete</button></li>
                </ul>
            </div>
        `

            if (f.is_dir) {
                const nameSpan = li.querySelector(".file-name-span")
                nameSpan.classList.add("folder-link")
                nameSpan.addEventListener("click", () => navigate(f.name))
            }

            li.querySelector(".rename-btn").addEventListener("click", (e) => {
                renamePrompt(f.name, e.target)
            })

            li.querySelector(".download-btn").addEventListener("click", (e) => {
                downloadItem(f.name, f.is_dir)
            })

            li.querySelector(".delete-btn").addEventListener("click", (e) => {
                deleteItem(f.name)
            })
            li.addEventListener("mouseleave", () => {
                const dropdownBtn = li.querySelector(
                    '[data-bs-toggle="dropdown"]',
                )
                const dropdown = bootstrap.Dropdown.getInstance(dropdownBtn)
                if (dropdown) {
                    dropdown.hide()
                }
            })

            list.appendChild(li)
        })

        currentPathText.innerText = currentPath
        btnBack.disabled = historyBack.length === 0
        btnForward.disabled = historyForward.length === 0
        btnRefresh.innerHTML = `<i class="bi bi-arrow-clockwise"></i>`
        btnRefresh.disabled = false
    } catch (err) {
        console.error("Failed to load files from server:", err)
        showToast("Error loading files")
    }
}

function navigate(folder) {
    historyBack.push(currentPath)
    historyForward = []
    currentPath =
        currentPath === "/" ? `/${folder}` : `${currentPath}/${folder}`
    loadFiles()
}

function goBack() {
    if (historyBack.length === 0) return
    historyForward.push(currentPath)
    currentPath = historyBack.pop()
    loadFiles()
}

function goForward() {
    if (historyForward.length === 0) return
    historyBack.push(currentPath)
    currentPath = historyForward.pop()
    loadFiles()
}

function createFileOrFolderPrompt(isDir = false) {
    const item = isDir == true ? "folder" : "file"
    const iconClass =
        isDir === true
            ? "bi-folder-fill text-warning"
            : "bi-file-earmark-text text-light"

    const list = document.getElementById("file-list")
    const li = document.createElement("li")
    li.className = "list-group-item file-item d-flex align-items-center gap-2"
    li.innerHTML = `<i class="bi ${iconClass}"></i><input type="text" class="file-name-input flex-grow-1" placeholder="New ${item} name">`
    list.prepend(li)

    const input = li.querySelector("input")
    input.focus()

    let isFinished = false

    const finish = async (save) => {
        if (isFinished) return
        isFinished = true

        if (save && input.value.trim() !== "") {
            try {
                const res = await fetch(
                    `/api/files?path=${encodeURIComponent(currentPath)}`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            name: input.value.trim(),
                            is_dir: isDir,
                        }),
                    },
                )
                if (!res.ok) {
                    throw new Error(`Server returned status: ${res.status}`)
                }
            } catch (err) {
                console.error(`Failed to create ${item} on server:`, err)
                showToast(`Error creating ${item}`)
            }
        }
        loadFiles()
    }

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") finish(true)
        if (e.key === "Escape") finish(false)
    })
    input.addEventListener("blur", () => finish(false))
}

function renamePrompt(oldName, btnEl) {
    const li = btnEl.closest(".file-item")
    const span = li.querySelector(".file-name-span")
    span.outerHTML = `<input type="text" class="file-name-input" value="${oldName}" style="width: 100%;">`

    const input = li.querySelector("input")
    input.focus()
    input.select()

    let isFinished = false

    const finish = async (save) => {
        if (isFinished) return
        isFinished = true

        const newName = input.value.trim()
        if (save && newName !== "" && newName !== oldName) {
            try {
                const res = await fetch(
                    `/api/files?path=${encodeURIComponent(currentPath)}`,
                    {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            old_name: oldName,
                            new_name: newName,
                        }),
                    },
                )
                if (!res.ok) {
                    throw new Error(`Server returned status: ${res.status}`)
                }
            } catch (err) {
                console.error("Failed to rename item:", err)
                showToast("Error renaming file")
            }
        }
        loadFiles()
    }

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") finish(true)
        if (e.key === "Escape") finish(false)
    })
    input.addEventListener("blur", () => finish(true))
}

async function deleteItem(name) {
    try {
        const res = await fetch(
            `/api/files?path=${encodeURIComponent(currentPath)}&name=${encodeURIComponent(name)}`,
            { method: "DELETE" },
        )
        if (!res.ok) {
            throw new Error(`Server returned status: ${res.status}`)
        }
    } catch (err) {
        console.error("Failed to delete item:", err)
        showToast("Error deleting item")
    }
    loadFiles()
}

async function downloadItem(name, isDir) {
    if (!isDir) {
        window.location = `/api/download/file?path=${encodeURIComponent(currentPath)}&name=${encodeURIComponent(name)}`
        return
    }

    showToast(`Zipping ${name}: 0%`)

    try {
        const res = await fetch(
            `/api/download/folder?path=${encodeURIComponent(currentPath)}&name=${encodeURIComponent(name)}`,
            { method: "POST" },
        )
        if (!res.ok) {
            throw new Error(`Server returned status: ${res.status}`)
        }
        const { task_id } = await res.json()

        const poll = setInterval(async () => {
            try {
                const stRes = await fetch(`/api/download/progress/${task_id}`)
                if (!stRes.ok) {
                    throw new Error(`Server returned status: ${stRes.status}`)
                }
                const state = await stRes.json()
                showToast(`Zipping ${name}: ${state.progress}%`)

                if (state.status === "done") {
                    clearInterval(poll)
                    showToast(`Download ready: ${name}.zip`)
                    window.location = `/api/download/file?path=${encodeURIComponent(currentPath)}&name=${encodeURIComponent(name)}&task_id=${task_id}`
                }
            } catch (pollErr) {
                console.error("Failed to fetch download progress:", pollErr)
                clearInterval(poll)
                showToast("Error zipping folder")
            }
        }, 500)
    } catch (err) {
        console.error("Failed to start zip task:", err)
        showToast("Error starting zip task")
    }
}

async function processUploadBatch(fileItems) {
    if (fileItems.length === 0) return

    showToast(`Uploading... 0 / ${fileItems.length} files processed.`)
    let uploadedCount = 0
    const batchSize = 10

    for (let i = 0; i < fileItems.length; i += batchSize) {
        const batch = fileItems.slice(i, i + batchSize)
        const formData = new FormData()
        formData.append("path", currentPath)

        batch.forEach((item) => {
            formData.append("files", item.file)
            formData.append("paths", item.relativePath)
        })

        try {
            const res = await fetch("/api/upload", {
                method: "POST",
                body: formData,
            })
            if (!res.ok) throw new Error(`Status: ${res.status}`)

            uploadedCount += batch.length
            showToast(
                `Uploading... ${uploadedCount} / ${fileItems.length} files processed.`,
            )
        } catch (err) {
            console.error("Upload failed for batch:", err)
            showToast("Error uploading some files")
            break
        }
    }

    showToast("Upload complete")
    loadFiles()
}

async function handleUpload(e) {
    const files = e.target.files
    if (files.length === 0) return

    const fileItems = Array.from(files).map((file) => ({
        file: file,
        relativePath: file.webkitRelativePath || file.name,
    }))

    await processUploadBatch(fileItems)
    e.target.value = ""
}

async function handleDrop(e) {
    const items = e.dataTransfer.items
    if (!items) return

    showToast("Reading file structure...")
    const filesToUpload = []

    async function processEntry(entry, path) {
        if (entry.isFile) {
            const file = await new Promise((resolve) => entry.file(resolve))
            filesToUpload.push({ file: file, relativePath: path + file.name })
        } else if (entry.isDirectory) {
            const dirReader = entry.createReader()

            const readAllEntries = async () => {
                let allEntries = []
                let readEntries = async () => {
                    const entries = await new Promise((resolve) =>
                        dirReader.readEntries(resolve),
                    )
                    if (entries.length > 0) {
                        allEntries = allEntries.concat(entries)
                        await readEntries()
                    }
                }
                await readEntries()
                return allEntries
            }

            const entries = await readAllEntries()
            for (const childEntry of entries) {
                await processEntry(childEntry, path + entry.name + "/")
            }
        }
    }

    const promises = []
    for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === "file") {
            const entry = item.webkitGetAsEntry()
            if (entry) {
                promises.push(processEntry(entry, ""))
            }
        }
    }

    await Promise.all(promises)
    await processUploadBatch(filesToUpload)
}

function resizeTerminal() {
    if (activeTabId && tabs[activeTabId]) {
        setTimeout(() => tabs[activeTabId].fitAddon.fit(), 20)
    }
}

init()
