"""Regenerate the EasyWorship test fixture.

Run: python3 src/main/importSources/__fixtures__/make-fixture.py

Node cannot build this file: better-sqlite3 and node:sqlite both lack a create-collation
API, and SQLite rejects CREATE TABLE with an unregistered collation. The declaration is the
point of the fixture — it is what makes the adapter's collation-safe SQL testable.
"""
import os
import sqlite3

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ew')
os.makedirs(HERE, exist_ok=True)

AMAZING = (
    r'{\rtf1\ansi\ansicpg1252{\fonttbl{\f0\fnil Arial;}}\f0\fs40 '
    r'Verse 1\par Amazing grace! how sweet the sound\par '
    r'That saved a wretch like me\par\par Chorus\par Praise God\par}'
)
BLESSED = (
    r'{\rtf1\ansi{\fonttbl{\f0\fnil Tahoma;}}{\*\generator Riched20 10.0;}'
    r'Verse 1\par Blessed assurance, Jesus is mine\par It\u8217?s a foretaste\par '
    r'caf\'e9 song\par}'
)
EMPTY = r'{\rtf1\ansi{\fonttbl{\f0\fnil Arial;}}\par\par}'


def build(name, ddl, rows):
    path = os.path.join(HERE, name)
    if os.path.exists(path):
        os.remove(path)
    con = sqlite3.connect(path)
    con.create_collation('UTF8_U_CI', lambda a, b: (a.lower() > b.lower()) - (a.lower() < b.lower()))
    con.execute(ddl)
    con.executemany('INSERT INTO %s VALUES (%s)' % (
        'song' if name == 'Songs.db' else 'word',
        ','.join('?' * len(rows[0])),
    ), rows)
    con.commit()
    con.close()


build(
    'Songs.db',
    'CREATE TABLE song (song_item_uid TEXT, title TEXT COLLATE UTF8_U_CI, '
    'author TEXT COLLATE UTF8_U_CI, copyright TEXT, ccli_no TEXT)',
    [
        ('u1', 'Amazing Grace', 'John Newton', 'Public Domain', '22025'),
        ('u2', 'Blessed Assurance', 'Fanny Crosby', 'Public Domain', '22324'),
        ('u3', 'Empty Song', '', '', ''),
        ('u4', 'No Words Song', '', '', ''),
    ],
)
# EasyWorship indexes title; the index must not make a bare scan fail.
con = sqlite3.connect(os.path.join(HERE, 'Songs.db'))
con.create_collation('UTF8_U_CI', lambda a, b: (a.lower() > b.lower()) - (a.lower() < b.lower()))
con.execute('CREATE INDEX idx_song_title ON song (title)')
con.commit()
con.close()

build(
    'SongWords.db',
    'CREATE TABLE word (song_id INTEGER, words TEXT COLLATE UTF8_U_CI)',
    [(1, AMAZING), (2, BLESSED), (3, EMPTY)],  # rowid 4 deliberately has no lyric row
)
print('fixture written to', HERE)
