# Third-party notices

These license texts are retained inputs to Windows release packaging. `sources.json` records the original source and SHA-256 for each file. They were copied unchanged from the earlier comparison package; packaging no longer depends on that experimental tree.

The .NET and ASP.NET Core runtime notices correspond to the packaged 10.0.12 runtime. Review them when changing the runtime version. The ASCOM notices came from the original local toolkit host. SQLite notices retain the versions identified in `sources.json`.

`tools/package.py` also collects license files and attribution metadata from the restored NuGet packages into each release's `licenses/` directory. This inventory describes dependencies and does not assign a license to Cria itself.
