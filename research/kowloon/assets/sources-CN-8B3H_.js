import{t as e}from"./a11y-2XVoxmNu.js";/* empty css              */e();var t=e=>document.querySelector(e),n=e=>String(e??``).replace(/[&<>"]/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`})[e]),r=await fetch(`./data/sources.json`).then(e=>{if(!e.ok)throw Error(e.status);return e.json()}).catch(e=>{throw t(`#status`).textContent=`The sources could not be loaded. Reload the page to try again.`,e}),i=e=>`<span class="badge ${n(e)}">${n(e)}</span>`,a=(e,t)=>{let i=r.sources[e];if(!i)return n(e);let a=n(i.title)+(t?`, ${n(t)}`:``);return i.url?`<a href="${n(i.url)}" target="_blank" rel="noopener">${a}</a>`:a},o=e=>`<li class="fact" id="f-${n(e.id)}" data-topic="${n(e.topic)}" data-cert="${n(e.certainty)}">
  <p>${i(e.certainty)} ${n(e.claim)}${e.value?`: <b>${n(e.value)}</b>`:``} <span class="era">${n(e.era)}</span></p>
  <p class="src">${e.sources.map(e=>a(e.id,e.loc)).join(`; `)}</p>
  ${e.note?`<p class="note">${n(e.note)}</p>`:``}
  ${e.conflicts.length?`<p class="note">Compare: ${e.conflicts.map(e=>`<a href="#f-${n(e)}">${n(e)}</a>`).join(`, `)}</p>`:``}</li>`,s=[...new Set(r.facts.map(e=>e.topic))].sort(),c=r.levels.map(e=>e.id).filter(e=>r.facts.some(t=>t.certainty===e)),l=Object.fromEntries(r.facts.map(e=>[e.id,e])),u=(e,t)=>r.facts.filter(n=>n[e]===t).length;t(`#main`).innerHTML=`
<section id="made" class="period"><h2>Who made this</h2>
  <p class="period-text">Claude Opus 5.5, Anthropic's AI model, wrote all of this under the instruction of
    <a href="https://nomagicpill.site/">nomagicpill</a>, working in Claude Code: the research, the tracing of the survey sheets,
    the 3D model and the six places, the code, and the text on every page. nomagicpill decided what to make and set its rules: only
    open-licensed photographs, and every fact labelled with how sure we are of it and where it comes from. Then they steered the work as it grew.</p>
  <p class="period-text">The photographs, surface scans and code libraries are other people's work, credited where they appear, and the
    residents' words are their own. An AI can get things wrong, which is why every fact below links to its source. If you spot a mistake,
    or lived or worked in the walled city and remember it differently, <a href="https://nomagicpill.site/about/about.html#contact">please get in touch</a>.</p></section>

<section id="method" class="period"><h2>How the model was made</h2>
  <ol class="method">${r.method.map(e=>`<li><h3>${n(e.title)} ${i(e.certainty)}</h3><p>${n(e.text)}</p></li>`).join(``)}</ol>
  ${r.materials&&r.materials.length?`<p class="note" id="materials">Photo-style surfaces and light (CC0, <a href="https://polyhaven.com" target="_blank" rel="noopener">Poly Haven</a>): ${r.materials.map(e=>`<a href="${n(e.page)}" target="_blank" rel="noopener">${n(e.name)}</a> (${n(e.authors.join(`, `))})`).join(` · `)}.</p>`:``}</section>

<section id="levels" class="period"><h2>How sure we are</h2>
  <p class="period-text">Everything in the model and every fact carries one of these labels.</p>
  <dl class="levels">${r.levels.map(e=>`<dt>${i(e.id)}</dt><dd>${n(e.text)}</dd>`).join(``)}</dl></section>

<section id="facts" class="period"><h2>Every fact <small>${r.facts.length}</small></h2>
  <div class="filters" role="group" aria-label="Filter the facts">
    <input id="fq" type="search" placeholder="Search the facts" aria-label="Search the facts" />
    <select id="ftopic" aria-label="Topic"><option value="">All topics</option>${s.map(e=>`<option value="${n(e)}">${n(e)} (${u(`topic`,e)})</option>`).join(``)}</select>
    <select id="fcert" aria-label="Certainty"><option value="">Any certainty</option>${c.map(e=>`<option value="${n(e)}">${n(e)} (${u(`certainty`,e)})</option>`).join(``)}</select>
    <span id="fcount" class="fcount" role="status"></span>
  </div>
  <ul class="facts">${r.facts.map(o).join(``)}</ul></section>

<section id="disagree" class="period"><h2>Where sources disagree <small>${r.disagreements.length}</small></h2>
  <p class="period-text">Figures that differ between sources are kept side by side rather than averaged; the model uses the one noted in each part.</p>
  <ul class="pairs">${r.disagreements.map(([e,t])=>`<li><ul class="pairfacts">${o(l[e]).replace(/id="f-[^"]*"/,``)}${o(l[t]).replace(/id="f-[^"]*"/,``)}</ul></li>`).join(``)}</ul></section>

<section id="sources" class="period"><h2>Sources <small>${Object.keys(r.sources).length}</small></h2>
  <ul class="srclist">${Object.entries(r.sources).map(([e,t])=>`<li><p>${t.url?`<a href="${n(t.url)}" target="_blank" rel="noopener">${n(t.title)}</a>`:n(t.title)}</p>
    <p class="note">${n(t.type)}${t.note?` · ${n(t.note)}`:``} · ${r.facts.filter(t=>t.sources.some(t=>t.id===e)).length} facts</p></li>`).join(``)}</ul></section>

<section id="screen" class="period"><h2>On screen and in print</h2>
  <p class="period-text">${n(r.screen_note)}</p>
  ${[`filmed`,`photographed`,`lived`,`set`,`inspired`].map(e=>{let t=r.screen.filter(t=>t.connection===e);return t.length?`<h3 class="sgroup">${n(t[0].label)}</h3><ul class="works">${t.map(e=>`<li><p><b>${n(e.title)}</b> <span class="era">${n(e.year)} · ${n(e.kind)}</span></p>
      <p>${n(e.text)}</p><p class="src">${e.links.map(e=>`<a href="${n(e.href)}" target="_blank" rel="noopener">${n(e.label)}</a>`).join(` · `)}</p></li>`).join(``)}</ul>`:``}).join(``)}</section>`;var d=[...document.querySelectorAll(`#facts .fact`)],f=e=>e.toLowerCase();function p(){let e=f(t(`#fq`).value.trim()),n=t(`#ftopic`).value,r=t(`#fcert`).value,i=0;for(let t of d){let a=(!n||t.dataset.topic===n)&&(!r||t.dataset.cert===r)&&(!e||f(t.textContent).includes(e));t.hidden=!a,i+=a}t(`#fcount`).textContent=`${i} of ${d.length}`}if([`input`,`change`].forEach(e=>[`#fq`,`#ftopic`,`#fcert`].forEach(n=>t(n).addEventListener(e,p))),p(),location.hash){let e=document.querySelector(location.hash);e&&e.scrollIntoView()}