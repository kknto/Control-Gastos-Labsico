import sqlite3
import json

try:
    conn = sqlite3.connect('finance.db')
    c = conn.cursor()
    print("--- Settings Table ---")
    rows = c.execute("SELECT * FROM settings").fetchall()
    for row in rows:
        print(f"Key: {row[0]}, Value: {row[1]}")
    
    if not rows:
        print("SETTINGS TABLE IS EMPTY!")
    
    print("\n--- Transactions Table ---")
    count = c.execute("SELECT count(*) FROM transactions").fetchone()[0]
    print(f"Transaction count: {count}")
    
    conn.close()
except Exception as e:
    print(f"ERROR: {e}")
