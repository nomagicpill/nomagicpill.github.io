# CLAUDE.md

Instructions for Claude working in this repo. These override default behavior.

## Never write the user's real name anywhere

The site is public (GitHub Pages + Cloudflare, repo `nomagicpill/nomagicpill.github.io`).
The author publishes as **nomagicpill** and nothing else.

Never put their real name — or any path containing it, such as
`/Users/<name>/...` — into a file, a comment, a doc, a commit message, or
anything else that lands in the repo. This includes files produced as a side
effect: `__pycache__/*.pyc` bakes the absolute source path in, so don't leave
one behind (`__pycache__/` is gitignored; run throwaway imports from the
scratchpad, not in-tree).

For home-relative paths write `~/Documents/nomagicpill.github.io`. If a real
name or absolute path already exists in a file, flag it rather than assuming
it's intentional.

## Never discard uncommitted work

The working tree normally carries uncommitted, hand-written content: new film
and book entries, draft posts, untracked cover images. `git status` at the start
of a session may be stale — do not trust it.

Never run `git checkout <file>`, `git restore`, `git reset --hard`, `git clean`,
or `git stash` to undo your own edits. They silently take the user's in-flight
work with them.

To undo an edit, reverse that exact edit — a targeted string replacement of what
you inserted. To test something destructive, copy the file to the scratchpad and
test there.

(This is written down because it happened: a `git checkout knowledge/film.html`
to revert a test destroyed five uncommitted entries, and one review was
unrecoverable.)

## Site conventions

No build step, no framework, no npm, no CI — see [ARCHITECTURE.md](ARCHITECTURE.md)
and follow it. Helper scripts (`knowledge/add_book.py`, `knowledge/add_film.py`)
are stdlib-only Python, run by hand, and live beside the page they edit.
