"""Package only reviewed build outputs, manifests and dependency notices; never local config/data."""
from pathlib import Path
import hashlib,json,shutil,sys,xml.etree.ElementTree as ET,zipfile
root=Path(__file__).resolve().parents[1]
out=Path(sys.argv[1]).resolve()
if out.parent!=root/'artifacts' or not out.name.startswith('win-x64.'):raise ValueError('Fresh package staging directory required')
licenses=out/'licenses';licenses.mkdir(exist_ok=True)
# Runtime license texts were collected with the earlier pinned 10.0.12 comparison package.
for name in ['dotnet-LICENSE','dotnet-THIRD-PARTY-NOTICES','aspnetcore-LICENSE','aspnetcore-THIRD-PARTY-NOTICES','ASCOMLibrary-LICENSE','ASCOM-Exceptions-LICENSE','SQLitePCLRaw-LICENSE','SQLitePCLRaw-NOTICE','SQLite-LICENSE']:
    shutil.copy2(root/'licenses/third-party'/name,licenses/name)
records={}
for project in ['Cria.Api','Cria.Driver.Windows','Cria.Desktop']:
    assets=json.loads((root/'src'/project/'obj/project.assets.json').read_text());cache=Path(next(iter(assets['packageFolders'])))
    for key,item in assets['libraries'].items():
        if item['type']!='package':continue
        location=cache/item['path'];spec=next(location.glob('*.nuspec'));metadata=ET.parse(spec).getroot().find('{*}metadata')
        def field(name):
            node=metadata.find('{*}'+name);return node.text if node is not None else None
        record={'package':key,'authors':field('authors'),'copyright':field('copyright'),'license':field('license'),'licenseUrl':field('licenseUrl'),'projectUrl':field('projectUrl'),'scope':'build and runtime dependency inventory'}
        records[key]=record
        notices=list(location.glob('LICENSE*'))+list(location.glob('NOTICE*'))+list(location.glob('ThirdPartyNotices*'))
        license_node=metadata.find('{*}license')
        if license_node is not None and license_node.attrib.get('type')=='file':
            path=(location/(license_node.text or '')).resolve()
            if not path.is_relative_to(location.resolve()):raise ValueError('License path escaped package')
            if path.is_file():notices.append(path)
        for notice in set(notices):
            if notice.is_file():shutil.copy2(notice,licenses/(key.replace('/','-')+'-'+notice.name))
(licenses/'dependencies.json').write_text(json.dumps(list(records.values()),indent=2)+'\n')
# All dependencies with MIT expressions share this text; individual copyright notices remain above.
(licenses/'MIT.txt').write_text('''MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
''')
manifest={str(p.relative_to(out)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.rglob('*')) if p.is_file() and p.name!='manifest-sha256.json'}
(out/'manifest-sha256.json').write_text(json.dumps(manifest,indent=2)+'\n')
archive=root/'artifacts/cria-dotnet-win-x64.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(out.rglob('*')):
        if p.is_file():z.write(p,str(p.relative_to(out)))
print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'files':len(manifest)},indent=2))
