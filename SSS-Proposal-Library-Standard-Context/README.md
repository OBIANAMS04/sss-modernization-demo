# SSS Proposal Library — Standard-Context Package

This package removes the five large Base64 PDF payloads from the HTML and stores the PDFs in `pdfs/`. The site content and behavior remain available, while `index.html` is small enough for standard-context coding tools.

## Local preview

From this folder, run:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

Do not open `index.html` by double-clicking if PDF links are blocked by browser security; use the local server command above.

## Claude Code

Start Claude Code from this folder:

```bash
claude --model sonnet
```

Then enter a short instruction such as:

```text
Inspect index.html and the pdfs folder. Fix and deploy this static site. Do not read or quote PDF binary data unless needed for validation.
```
