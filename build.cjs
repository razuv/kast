const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const src = path.join(__dirname, 'src');
const out = path.join(__dirname, 'docs');
if (!fs.existsSync(src)) throw new Error('Local-only src folder is required to build the preview.');
fs.mkdirSync(out, {recursive:true});
fs.cpSync(path.join(src,'assets'), path.join(out,'assets'), {recursive:true});
const notice = '<p class="preview-notice">Демонстрационная концепция КАСТ. Использование дизайна и материалов требует согласования с автором.</p>';
for (const file of ['index.html','showcase.html']) {
  const html = fs.readFileSync(path.join(src,file),'utf8')
    .replace('<meta charset="utf-8">','<meta charset="utf-8"><meta name="robots" content="noindex,nofollow,noarchive,noimageindex,nosnippet">')
    .replace('</footer>',notice+'</footer>')
    .replace(/<!--[^]*?-->/g,'').replace(/>\s+</g,'><').replaceAll('creative-6','preview-1');
  fs.writeFileSync(path.join(out,file),html);
}
const deterrence = `
document.addEventListener('dragstart',event=>{if(event.target instanceof Element&&event.target.closest('img'))event.preventDefault()});
document.addEventListener('contextmenu',event=>{if(event.target instanceof Element&&event.target.closest('img'))event.preventDefault()});`;
const previewCss = `img{-webkit-user-drag:none;-webkit-touch-callout:none;user-select:none}.preview-notice{font-size:11px;line-height:1.7;color:var(--sage);max-width:700px;margin-top:25px}@media print{body>*{display:none!important}body:after{content:"Демонстрационная концепция КАСТ. Печатная версия не предназначена для распространения.";display:block;padding:40px;font:18px sans-serif}}`;
for (const [file,loader,extra] of [['app.js','js',deterrence],['style.css','css',previewCss]]) {
  const code = fs.readFileSync(path.join(src,file),'utf8')+'\n'+extra;
  const result = esbuild.transformSync(code,{loader,minify:true,charset:'utf8',legalComments:'none',...(loader==='js'?{format:'iife',target:'es2022'}:{})});
  fs.writeFileSync(path.join(out,file),result.code);
}
fs.writeFileSync(path.join(out,'robots.txt'),'User-agent: *\nDisallow: /\n');
fs.writeFileSync(path.join(out,'.nojekyll'),'');
console.log('Client preview built in docs/');
