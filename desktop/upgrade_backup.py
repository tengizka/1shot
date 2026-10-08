"""Local upgrade backup only. No cloud/Gizmo access and no credential output."""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import time


def backup(source, destination):
    source=Path(source).resolve(strict=True);destination=Path(destination).absolute()
    if not source.is_dir() or destination.exists() or source==destination or source in destination.resolve().parents:
        raise ValueError('INVALID_BACKUP_PATH')
    files=[]
    # Refuse symlinks/junctions rather than traversing outside the settings folder.
    for root, dirs, names in os.walk(source,followlinks=False):
        for name in dirs+names:
            path=Path(root)/name
            if path.is_symlink() or (getattr(path.lstat(),'st_file_attributes',0)&0x400):raise ValueError('LINK_IN_SETTINGS')
        files.extend(Path(root)/name for name in names)
    destination.mkdir(parents=False,exist_ok=False)
    manifest={'format':'1shot-desk-backup-v1','files':[]}
    try:
        for path in sorted(files):
            # WAL/SHM/journal are included in the SQLite backup API snapshot, not copied as sidecars.
            if any(path.name.endswith(suffix) and Path(str(path)[:-len(suffix)]).suffix.lower() in ('.sqlite3','.sqlite','.db') and Path(str(path)[:-len(suffix)]).exists() for suffix in ('-wal','-shm','-journal')):continue
            relative=path.relative_to(source);target=destination/relative;target.parent.mkdir(parents=True,exist_ok=True)
            is_db=path.suffix.lower() in ('.sqlite3','.sqlite','.db')
            if is_db:
                with closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True,timeout=10)) as src, closing(sqlite3.connect(target)) as dst:
                    deadline=time.monotonic()+60
                    def progress(*_):
                        if time.monotonic()>deadline:raise TimeoutError('SQLITE_BACKUP_TIMEOUT')
                    src.backup(dst,pages=256,progress=progress,sleep=0.1)
                    dst.execute('pragma journal_mode=DELETE')
                    if dst.execute('pragma integrity_check').fetchall()!=[('ok',)]:raise ValueError('SQLITE_INTEGRITY_FAILED')
            else:
                before=hashlib.sha256(path.read_bytes()).digest();shutil.copy2(path,target)
                if before!=hashlib.sha256(path.read_bytes()).digest() or before!=hashlib.sha256(target.read_bytes()).digest():raise ValueError('SETTINGS_CHANGED_DURING_BACKUP')
            manifest['files'].append({'path':relative.as_posix(),'size':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'sqlite':is_db})
        (destination/'backup-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
        verify(destination)
        return manifest
    except Exception:
        # Retain incomplete backups for diagnosis; absence of a valid manifest prevents use.
        (destination/'BACKUP_FAILED').touch()
        raise


def verify(destination):
    destination=Path(destination);manifest=json.loads((destination/'backup-manifest.json').read_text(encoding='utf-8'))
    if manifest.get('format')!='1shot-desk-backup-v1' or (destination/'BACKUP_FAILED').exists():raise ValueError('INVALID_BACKUP')
    for row in manifest['files']:
        path=(destination/row['path']).resolve()
        if destination.resolve() not in path.parents or path.is_symlink():raise ValueError('INVALID_MANIFEST_PATH')
        if path.stat().st_size!=row['size'] or hashlib.sha256(path.read_bytes()).hexdigest()!=row['sha256']:raise ValueError('BACKUP_CHECKSUM_FAILED')
    return True


def main(args=None):
    args=sys.argv[1:] if args is None else args
    try:
        if len(args)!=2:raise ValueError('ARGUMENTS_REQUIRED')
        result=backup(*args)
        print(json.dumps({'ok':True,'files':len(result['files'])}))
        return 0
    except Exception:
        print('LOCAL_BACKUP_FAILED',file=sys.stderr)
        return 1

if __name__=='__main__':sys.exit(main())
