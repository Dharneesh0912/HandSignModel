import os
from pathlib import Path


def dump_files_to_text(
    root_folder, output_file, exclude_folders=None, exclude_files=None, encoding="utf-8"
):
    root_folder = Path(root_folder).resolve()
    output_file = Path(output_file).resolve()

    if exclude_folders is None:
        exclude_folders = []
    if exclude_files is None:
        exclude_files = []

    with output_file.open("w", encoding=encoding) as outfile:
        for root, dirs, files in os.walk(root_folder):

            current_path = Path(root).resolve()
            dirs[:] = [d for d in dirs if d not in exclude_folders]
            for file in files:
                if file in exclude_files:
                    continue
                file_path = current_path / file
                try:
                    content = file_path.read_text(encoding=encoding)
                    content = "\n".join(
                        line for line in content.splitlines() if line.strip()
                    )
                    outfile.write(f"FILE: {file_path}\n{content}\n\n")
                except (UnicodeDecodeError, PermissionError, OSError):
                    outfile.write(f"FILE: {file_path}\nFile can't be read\n\n")
                    print(f"Skipped (unreadable): {file_path}")

    print(f"\nDone. Output written to: {output_file}")


if __name__ == "__main__":
    root_directory = "D:\\HandSignModel"
    output_txt_file = "D:\\HandSignModel\\Project.txt"

    exclude_folders = [
        "__pycache__",
        ".git",
        "node_modules",
        "venv",
        ".venv",
        "staticfiles",
        "logs",
    ]

    exclude_files = [
        ".DS_Store",
        "script.py",
        "Employee_chat_agent.txt",
        "Manager_chat_agent.txt",
        "HCM_Manager_chat_agent.txt",
        "data.py",
        "FSM.xlsx",
        "backup.txt",
        "requirements.txt"
    ]

    dump_files_to_text(
        root_directory,
        output_txt_file,
        exclude_folders,
        exclude_files,
    )