---
name: benign-minimal
description: Formats Markdown tables in the current file. Use when the user asks to align or clean up Markdown tables. NOT for CSV or HTML tables.
version: 1.0.0
---

# benign-minimal

Formats Markdown tables in place.

## Steps

1. Read the file the user pointed at. If it does not exist, stop and report
   the path you tried.
2. Find every Markdown table block (lines containing `|` separators).
3. Rewrite each table so column widths align. Overwrite the block in full —
   running this twice produces the same output.
4. Save the file and show the user a summary: how many tables were changed.

## Output

The edited file, plus one summary line: `Formatted N tables in <path>.`

## Changelog

- 1.0.0 — initial version.
