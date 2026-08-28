# web-terminal-manager

This is a simple, one page website that has a terminal and a file browser, to control a dedicated server more easily. **Tested only on Linux**

## Configuration

### .env
Create `.env` file from `.env.sample`. This file sets the behavior of the website through *Environment variables*

- **FILEBROWSER_ONLY_MODE** Can be *`true`* or *`false`*. Blocks the terminal, leaving only the file browser available.
- **ROOT_DIR** Can be any valid path string. Sets the root dir for the file browser.
- **BASHRC_PATH** Can be any valid path string. Sets the file path to the .bashrc file to use in each created terminal.
- **PS1** Can be any valid cmd prompt string. Sets the PS1 prompt to use in each created terminal.
- **AUTH_USERNAME** Can be any string. Sets the username to be used to login to the website. Leave empty for no username.
- **AUTH_PASSWORD** Can be any string. Sets the password to be used to login to the website. Leave empty for no password.

### .bashrc
Create `.bashrc` file from `.bashrc.sample`. This file is passed to every terminal created as an `--rcfile` option. A path to this file is specified in **BASHRC_PATH** Environment variable.

## Launching

1. Run `pip install -r requirements.txt` to install all needed python dependencies.
2. Run `python main.py` to start the website.

