(function(){
'use strict';
const steps=[
 {title:'Identificação profissional',desc:'Confira os dados oficiais e complete seu contato profissional.',fields:[['nomeOficial','Nome oficial',true],['empresa','Empresa',true],['setor','Setor',true],['cargoOficial','Cargo oficial',true],['email','E-mail corporativo',true],['nomeExibicao','Nome de exibição'],['cargoDeclarado','Função que exerce'],['gestorImediato','Gestor imediato'],['telefoneCorporativo','Telefone corporativo']]},
 {title:'O que você faz?',desc:'Conte sobre sua atuação no dia a dia.',fields:[['descricaoFuncao','Descrição da função *'],['atividades','Atividades principais'],['processos','Processos acompanhados'],['entregas','Principais entregas'],['setoresRelacionados','Setores com os quais trabalha']]},
 {title:'Quais são suas responsabilidades?',desc:'Registre seu escopo de atuação. Aprovações seguem as permissões oficiais.',fields:[['responsabilidades','Responsabilidades *'],['decisoes','Decisões que costuma tomar'],['aprovacoesNecessarias','Quando precisa de aprovação']]},
 {title:'O que você conhece?',desc:'Compartilhe seus conhecimentos para apoiar as análises.',fields:[['produtos','Produtos conhecidos'],['procedimentos','Procedimentos'],['especialidades','Especialidades técnicas'],['sistemas','Sistemas utilizados']]},
 {title:'Como seu conhecimento pode ajudar?',desc:'Indique situações em que pode contribuir.',fields:[['problemas','Tipos de problema que resolve'],['contribuicoes','Como pode contribuir']]}
];
const listFields=new Set(['atividades','processos','entregas','setoresRelacionados','responsabilidades','decisoes','aprovacoesNecessarias','produtos','procedimentos','especialidades','sistemas','problemas','contribuicoes']);
let profile={},step=0,completed=false,dirty=false,timer=null,savePromise=null;
const el=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const token=()=>sessionStorage.getItem('sac-token')||'';
async function call(method,body){const r=await fetch((window.SAC_API||'')+'/api/meu-perfil',{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token()},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json().catch(()=>({}));if(!r.ok||j.sucesso===false)throw Error(j.erro||'Não foi possível carregar o perfil.');return j}
function value(k){const v=profile[k];return Array.isArray(v)?v.join('; '):v||''}
function setStatus(s,error=false){const x=el('mp-status');if(x){x.textContent=s;x.style.color=error?'#b00000':'#707070'}}
function gather(){document.querySelectorAll('#mp-fields [data-mp-key]').forEach(x=>{profile[x.dataset.mpKey]=listFields.has(x.dataset.mpKey)?x.value.split(/[;,\n]/).map(t=>t.trim()).filter(Boolean):x.value.trim()});dirty=true}
function draw(){const s=steps[step];el('mp-step-label').textContent=`Etapa ${step+1} de ${steps.length}`;el('mp-title').textContent=s.title;el('mp-desc').textContent=s.desc;el('mp-progress').innerHTML=steps.map((_,i)=>`<button type="button" class="${i<=step?'on':''}" aria-label="Etapa ${i+1}" onclick="mpGo(${i})"></button>`).join('');el('mp-fields').innerHTML=s.fields.map(([k,label,official])=>`<label class="mp-field ${listFields.has(k)||k==='descricaoFuncao'?'wide':''}">${esc(label)}${listFields.has(k)||k==='descricaoFuncao'?`<textarea data-mp-key="${k}" ${official?'readonly':''} placeholder="${listFields.has(k)?'Separe os itens por ponto e vírgula':''}">${esc(value(k))}</textarea>`:`<input data-mp-key="${k}" value="${esc(value(k))}" ${official?'readonly class="mp-official"':''}>`}${official?'<span class="mp-help">Dado oficial: alterações são feitas pela administração.</span>':''}</label>`).join('');el('mp-prev').disabled=step===0;el('mp-next').textContent=step===steps.length-1?(completed?'Salvar perfil':'Concluir e acessar →'):'Continuar →';el('mp-badge').textContent=completed?'Perfil concluído':'Preenchimento obrigatório';el('mp-updated').textContent=profile.atualizadoEm?`Atualizado em ${new Date(profile.atualizadoEm).toLocaleString('pt-BR')}`:'Ainda não salvo';el('mp-error').textContent='';}
async function save(concluir=false){
  clearTimeout(timer);gather();
  if(savePromise){await savePromise;gather()}
  if(!dirty&&!concluir)return true;
  setStatus('Salvando…');
  const body={...profile,concluir};
  savePromise=(async()=>{
    try{
      const j=await call('PATCH',body);
      profile=j.perfil;completed=j.completo;window.mpPerfilPendente=!completed;dirty=false;
      if(j.token){sessionStorage.setItem('sac-token',j.token);try{if(localStorage.getItem('sac-remember-token'))localStorage.setItem('sac-remember-token',j.token)}catch{}}
      setStatus('Salvo');return true;
    }catch(e){el('mp-error').textContent=e.message;setStatus('Falha ao salvar. Tente novamente.',true);return false}
  })();
  try{return await savePromise}finally{savePromise=null}
}
async function go(n){gather();if(n<0||n>=steps.length)return;if(dirty&&!await save())return;step=n;draw()}
async function next(){gather();if(step<steps.length-1){await go(step+1);return}if(!profile.descricaoFuncao||!profile.responsabilidades?.length){el('mp-error').textContent='Preencha a descrição da função e ao menos uma responsabilidade nas etapas 2 e 3.';return}if(!await save(true))return;if(window.iniciarSessaoV5)await window.iniciarSessaoV5();if(window.navigate)window.navigate('visao-geral')}
function schedule(){gather();setStatus('Alterações pendentes');clearTimeout(timer);timer=setTimeout(()=>save(),700)}
async function load(){try{const j=await call('GET');profile=j.perfil;completed=j.completo;window.mpPerfilPendente=!completed;step=0;draw();return completed}catch(e){window.mpPerfilPendente=true;setStatus(e.message,true);el('mp-error').textContent=e.message;return null}}
window.mpGo=go;window.mpNext=next;window.mpPrev=()=>go(step-1);window.mpSave=()=>save();window.abrirMeuPerfil=async()=>{window.navigate('meu-perfil');await load()};
window.perfilProfissionalVerificar=async()=>{const status=await load();if(status===true)return true;const link=el('mp-user-link');if(link)link.style.display='';if(window.navigate)window.navigate('meu-perfil');return false};
const page=el('page-meu-perfil');if(page)page.addEventListener('input',e=>{if(e.target.matches('[data-mp-key]'))schedule()});
const oldNavigate=window.navigate;window.navigate=function(page,element,options){if(page!=='meu-perfil'&&!completed&&token())return oldNavigate('meu-perfil',null,options);return oldNavigate(page,element,options)};
})();
