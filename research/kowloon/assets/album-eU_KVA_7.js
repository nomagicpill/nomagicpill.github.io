import{a as e,t}from"./a11y-2XVoxmNu.js";/* empty css              */t();var n=e=>document.querySelector(e),r=e=>String(e??``).replace(/[&<>"]/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`})[e]),i=await fetch(`./data/album.json`).then(e=>{if(!e.ok)throw Error(e.status);return e.json()}).catch(e=>{throw n(`#album-status`).textContent=`The photographs could not be loaded. Reload the page to try again.`,e}),a=i.photos;function o(e){return e.license_url?`<a href="${r(e.license_url)}" target="_blank" rel="noopener">${r(e.license)}</a>`:r(e.license)}n(`#periods`).innerHTML=i.sections.map(e=>{let t=a.filter(t=>t.section===e.id).length;return`<a href="#s-${e.id}">${r(e.title)} <small>${t}</small></a>`}).join(``),n(`#album`).innerHTML=i.sections.map(e=>{let t=a.map((e,t)=>[e,t]).filter(([t])=>t.section===e.id);return`<section class="period" id="s-${e.id}" aria-labelledby="h-${e.id}">
    <h2 id="h-${e.id}">${r(e.title)}</h2><p class="period-text">${r(e.text)}</p>
    <ul class="grid">${t.map(([e,t])=>{let n=e.w/e.h;return`<li style="--r:${n.toFixed(3)};flex-grow:${n.toFixed(3)}">
        <button class="tile" data-i="${t}" aria-label="${r(e.caption)} (${r(e.date)})">
          <img src="${r(e.thumb)}" width="${e.tw}" height="${e.th}" alt="" loading="lazy" decoding="async" style="aspect-ratio:${e.w}/${e.h}" />
          <span class="tdate">${r(e.date)}</span>
        </button></li>`}).join(``)}<li class="filler" aria-hidden="true"></li></ul></section>`}).join(``),n(`#afoot`).innerHTML=`<p>${r(i.elsewhere_note)}</p>
  <p>More: ${i.elsewhere.map(e=>`<a href="${r(e.href)}" target="_blank" rel="noopener">${r(e.label)}</a>`).join(` · `)}</p>
  <p class="small">${a.length} photographs. Captions are this project's; dates, photographers and licences are as given on Wikimedia Commons.
    Photographs licensed CC BY-SA may be reused under the same licence, with credit.</p>
  <p class="small">Album made by Claude Opus 5.5 under the instruction of <a href="https://nomagicpill.site/">nomagicpill</a>.
    <a href="./sources.html#made">Who made this →</a></p>`;var s=n(`#viewer`),c=-1,l=null,u=null;function d(t,n=!0){c=(t+a.length)%a.length;let p=a[c],m=i.sections.find(e=>e.id===p.section);s.innerHTML=`<div class="vbox" role="dialog" aria-modal="true" aria-labelledby="v-cap">
    <figure>
      <div class="vimg"><img src="${r(p.src)}" alt="${r(p.caption)}" width="${p.w}" height="${p.h}" /></div>
      <figcaption>
        <p class="vmeta">${r(m.title)} · <b>${r(p.date)}</b> · ${c+1} of ${a.length}</p>
        <p id="v-cap" class="vcap">${r(p.caption)}</p>
        <p class="vcredit">${r(p.artist)}. ${o(p)}. <a href="${r(p.page)}" target="_blank" rel="noopener">Wikimedia Commons</a>
          ${p.link?` · <a href="${r(p.link.href)}">${r(p.link.label)}</a>`:``}</p>
      </figcaption>
    </figure>
    <button class="vnav prev" aria-label="Previous photograph">‹</button>
    <button class="vnav next" aria-label="Next photograph">›</button>
    <button class="vclose" aria-label="Close">×</button></div>`,s.hidden&&(u=document.activeElement,s.hidden=!1,document.body.classList.add(`viewing`),l=e(s)),s.querySelector(`.prev`).addEventListener(`click`,()=>d(c-1)),s.querySelector(`.next`).addEventListener(`click`,()=>d(c+1)),s.querySelector(`.vclose`).addEventListener(`click`,f),s.querySelector(`.vclose`).focus({preventScroll:!0}),n&&history.replaceState(null,``,`#${p.id}`);for(let e of[c+1,c-1]){let t=a[(e+a.length)%a.length];new Image().src=t.src}}function f(){if(s.hidden)return;s.hidden=!0,s.innerHTML=``,document.body.classList.remove(`viewing`),l&&=(l(),null),history.replaceState(null,``,location.pathname+location.search);let e=u&&document.contains(u)?u:document.querySelector(`.tile[data-i="${c}"]`);e&&e.focus({preventScroll:!1}),u=null}n(`#album`).addEventListener(`click`,e=>{let t=e.target.closest(`.tile`);t&&d(+t.dataset.i)}),s.addEventListener(`click`,e=>{(e.target===s||e.target.classList.contains(`vbox`))&&f()}),window.addEventListener(`keydown`,e=>{s.hidden||(e.key===`Escape`?(e.preventDefault(),f()):e.key===`ArrowRight`?(e.preventDefault(),d(c+1)):e.key===`ArrowLeft`&&(e.preventDefault(),d(c-1)))});var p=null,m=null;s.addEventListener(`pointerdown`,e=>{e.pointerType!==`mouse`&&(p=e.clientX,m=e.clientY)}),s.addEventListener(`pointerup`,e=>{if(p===null)return;let t=e.clientX-p,n=e.clientY-m;p=m=null,Math.abs(t)>50&&Math.abs(t)>Math.abs(n)*1.5&&d(c+(t<0?1:-1))});var h=()=>{let e=a.findIndex(e=>e.id===location.hash.slice(1));e>=0&&d(e,!1)};h(),window.addEventListener(`hashchange`,()=>{location.hash.startsWith(`#s-`)||h()});