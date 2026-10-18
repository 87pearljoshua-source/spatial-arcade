import os
import zipfile
import shutil

os.makedirs('public', exist_ok=True)
exclude_dirs = {'.git', 'node_modules', 'dist', '.aistudio', '__pycache__', '.vscode'}
exclude_files = {'public/project.zip', 'project.zip'}

with zipfile.ZipFile('public/project.zip', 'w', zipfile.ZIP_DEFLATED) as zipf:
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if d not in exclude_dirs and not d.startswith('.')]
        for file in files:
            filepath = os.path.join(root, file)
            relpath = os.path.relpath(filepath, '.')
            if relpath in exclude_files or relpath.startswith('public/project.zip') or any(ex in relpath.split(os.sep) for ex in exclude_dirs):
                continue
            zipf.write(filepath, relpath)

shutil.copy('public/project.zip', 'project.zip')
print('Project zip created successfully at /project.zip and /public/project.zip')
