[← Sourcebook](../README.md) · [Installation](installation.md) · [Docker](../docker/README.md) · [User guide](user-guide.md) · [Collaboration](collaboration.md) · [AI assistant](ai-assistant.md) · [REST API](rest-api.md) · [File format](file-format.md) · [Development](development.md) · [Libraries](libraries.md) · [Screenshots](screenshots.md)

# File format

Everything Sourcebook knows is in plain files in the workspace folder: readable, diffable and versionable outside the tool.

```
~/Sourcebook/
  projects/
    payment-service/            one project = one folder (the id is the folder name)
      project.json              name, description, createdAt, createdFrom?
      notebook.json             ordered index: id, title, parentId, order, folder
      references/               project input files of any type, user-defined folders (read-only in the app)
        .mcp/<file path>/       generated for the assistant (hidden, rebuilt automatically):
                                content.md, manifest.json, pages/p001.webp… (page images), figures/p003-1.webp… (PDF figures)
      bibliography.json         citable sources (key, type, name, authors, year, venue, title, DOI, link, BibTeX…)
      notifications.json        change notifications received from applications / assistants (not copied with the project)
      blocks/
        001-introduction/
          block.json            id, title, parentId, order, objective?, ordered sub-block refs
          subblocks/01-markdown.md
          subblocks/01-markdown.comments.json   comments on that sub-block (threads + replies)
        002-architecture/
          subblocks/01-mermaid.mmd, 01-mermaid.png, 01-mermaid.svg
          subblocks/02-drawing.excalidraw, 02-drawing.png
        003-data-model/         (nested under 002; numbering is depth-first)
          assets/<id>.png       uploaded images
          subblocks/01-image.md ![alt](../assets/<id>.png "caption")
          subblocks/02-code.py  code sub-block: the extension carries the language
          subblocks/03-question.json   { "question", "answer" }
          subblocks/04-choice.json     { "question", "mode": "single"|"multiple", "options": [{ "id", "text" }], "selected": [ids], "note" }
  templates/
    software-project/           same format as a project
```
