const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('esbuild');
const sharp = require('sharp');
const root = __dirname;
const src = path.join(root, 'src');
const out = path.join(root, 'docs');
const stage = path.join(root, 'work', 'release-stage');
const digest = data => crypto.createHash('sha256').update(data).digest('hex').slice(0, 10);
const write = (file, data) => fs.writeFileSync(path.join(stage, file), data);

async function build() {
  if (!fs.existsSync(src)) throw new Error('Local-only src folder is required to build the preview.');
  const input = Object.fromEntries(['index.html','style.css','app.js'].map(f => [f, fs.readFileSync(path.join(src,f),'utf8')]));
  const references = new Set();
  for (const text of Object.values(input)) {
    for (const match of text.matchAll(/assets\/([a-zA-Z0-9._-]+)/g)) references.add(match[1]);
  }
  for (const match of input['app.js'].matchAll(/image:\s*['"]([^'"]+)['"]/g)) references.add(match[1]);
  for (const file of references) {
    if (path.basename(file) !== file || !fs.existsSync(path.join(src,'assets',file))) throw new Error(`Missing source asset: ${file}`);
  }
  fs.rmSync(stage, {recursive:true,force:true});
  fs.mkdirSync(path.join(stage,'assets'), {recursive:true});
  const media = {};
  let sourceBytes = 0;
  for (const file of [...references].sort()) {
    const source = path.join(src,'assets',file);
    const data = fs.readFileSync(source);
    sourceBytes += data.length;
    const stem = path.parse(file).name;
    const hash = digest(data);
    if (/\.(png|jpe?g)$/i.test(file)) {
      const metadata = await sharp(source).metadata();
      const width = Math.min(metadata.width,1600);
      const widths = [...new Set([640,960,width].filter(w => w <= width))].sort((a,b) => a-b);
      const variants = [];
      let main;
      for (const w of widths) {
        const name = `${stem}.${hash}.${w}.webp`;
        const result = await sharp(source).rotate().resize({width:w,withoutEnlargement:true}).webp({quality:92,alphaQuality:100,effort:6}).toFile(path.join(stage,'assets',name));
        variants.push(`assets/${name} ${result.width}w`);
        main = {file:name,width:result.width,height:result.height};
      }
      media[file] = {...main,srcset:variants.join(', ')};
    } else {
      const name = `${stem}.${hash}${path.extname(file)}`;
      write(`assets/${name}`,data);
      media[file] = {file:name};
    }
  }
  const replaceAssets = text => text.replace(/assets\/([a-zA-Z0-9._-]+)/g, (_,file) => {
    if (!media[file]) throw new Error(`Unmapped asset: ${file}`);
    return `assets/${media[file].file}`;
  });
  const deterrence = `\ndocument.addEventListener('dragstart',event=>{if(event.target instanceof Element&&event.target.closest('img'))event.preventDefault()});\ndocument.addEventListener('contextmenu',event=>{if(event.target instanceof Element&&event.target.closest('img'))event.preventDefault()});`;
  const previewCss = `img{-webkit-user-drag:none;-webkit-touch-callout:none;user-select:none}@media print{body>*{display:none!important}body:after{content:"Демонстрационная концепция КАСТ. Печатная версия не предназначена для распространения.";display:block;padding:40px;font:18px sans-serif}}`;
  const css = esbuild.transformSync(replaceAssets(input['style.css'])+'\n'+previewCss,{loader:'css',minify:true,charset:'utf8',legalComments:'none'}).code;
  // Keep original keys in the runtime manifest so local source filenames remain stable.
  const js = esbuild.transformSync(input['app.js'].replace('const media = /* build:media */ {};',`const media = ${JSON.stringify(media)};`)+deterrence,{loader:'js',minify:true,charset:'utf8',legalComments:'none',format:'iife',target:'es2022'}).code;
  write('style.css',css);
  write('app.js',js);
  const heroSizes = '(max-width:760px) 72vw, (max-width:1000px) 540px, 47vw';
  for (const file of ['index.html']) {
    let html = input[file].replace(/<img\b[^>]*>/g, tag => {
      const name = tag.match(/\bsrc="assets\/([^"?]+)"/)?.[1];
      const picture = media[name];
      if (!picture?.srcset) return tag;
      const sizes = tag.includes('fetchpriority="high"') ? heroSizes : '(max-width:760px) 88vw, 44vw';
      return tag.replace(/\s(?:width|height|srcset|sizes)="[^"]*"/g,'').replace(/>$/,` width="${picture.width}" height="${picture.height}" srcset="${picture.srcset}" sizes="${sizes}" decoding="async">`);
    });
    html = html.replace(/<link\b[^>]*rel="preload"[^>]*as="image"[^>]*>/g, tag => {
      const picture = media[tag.match(/href="assets\/([^"?]+)"/)?.[1]];
      return picture?.srcset ? tag.replace(/>$/,` imagesrcset="${picture.srcset}" imagesizes="${heroSizes}">`) : tag;
    });
    // Responsive srcset values already contain generated names and must not be remapped.
    for (const [original,picture] of Object.entries(media)) html = html.replaceAll(`assets/${original}`,`assets/${picture.file}`);
    html = html.replace('<meta charset="utf-8">','<meta charset="utf-8"><meta name="robots" content="noindex,nofollow,noarchive,noimageindex,nosnippet">')
      .replace(/style\.css\?v=[^"']+/g,`style.css?v=${digest(css)}`)
      .replace(/app\.js\?v=[^"']+/g,`app.js?v=${digest(js)}`)
      .replace(/<!--[^]*?-->/g,'').replace(/>\s+</g,'><');
    write(file,html);
  }
  write('robots.txt','User-agent: *\nDisallow: /\n');
  write('.nojekyll','');
  fs.mkdirSync(path.join(stage,'v2'),{recursive:true});
  write('v2/index.html',"<!doctype html><html lang=\"ru\"><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex\"><meta http-equiv=\"refresh\" content=\"0;url=../\"><title>КАСТ</title><a href=\"../\">Перейти на сайт КАСТ</a><script>location.replace(new URL(\"../\",location.href).href+location.hash)</script></html>");
  const files = fs.readdirSync(path.join(stage,'assets'));
  const bytes = files.reduce((sum,f) => sum+fs.statSync(path.join(stage,'assets',f)).size,0);
  const report = {sourceAssets:references.size,sourceBytes,optimizedAssetFiles:files.length,optimizedBytes:bytes,media};
  fs.writeFileSync(path.join(root,'work','release-report.json'),JSON.stringify(report,null,2));
  fs.rmSync(out,{recursive:true,force:true});
  fs.renameSync(stage,out);
  console.log(`${references.size} source assets → ${files.length} optimized files; ${(sourceBytes/1048576).toFixed(2)} MB → ${(bytes/1048576).toFixed(2)} MB (including responsive variants).`);
}
build().catch(error => { console.error(error);process.exitCode=1; });
