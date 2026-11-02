const scenarios={
  allowed:{name:'Allowed request',call:'04 / 20',cap:'180 / 512',approval:'Off',steps:[
    {title:'An agent sends a request.',copy:'The connected Research assistant calls AUVEN with its own credential. This is an OpenAI chat request sent through the AUVEN gateway.',icon:'◈',state:'REQUEST RECEIVED',focus:'agent',data:[['AGENT','Research assistant'],['ROUTE','OpenAI chat'],['REQUEST ID','Unique']]},
    {title:'AUVEN checks its identity.',copy:'The credential identifies one registered agent. A stopped agent would be denied here, before reaching the provider.',icon:'◇',state:'IDENTITY VERIFIED',focus:'gate',data:[['IDENTITY','Registered'],['STATUS','Active'],['WORKSPACE','Matched']]},
    {title:'The policy allows this call.',copy:'The agent is within its daily request cap and response limit. Owner approval is off, so AUVEN can forward this call.',icon:'⌁',state:'ALLOWED',focus:'gate',data:[['TODAY','04 of 20 calls'],['RESPONSE','180 of 512 tokens'],['REVIEW','Not required']]},
    {title:'The provider receives it.',copy:'Only after the policy passes does AUVEN forward the request to OpenAI. The response returns through the gateway.',icon:'↗',state:'PROVIDER CALLED',focus:'provider',data:[['ROUTE','OpenAI chat'],['RESPONSE','Returned'],['BUDGET','Reserved, then settled']]},
    {title:'The decision is recorded.',copy:'Activity shows the agent, time, and result. The workspace owner can later create an ML-DSA-65 signed activity checkpoint and choose whether to publish its commitment.',icon:'▧',state:'RECORDED',focus:'gate',data:[['ACTIVITY','Allowed'],['REASON','Provider completed'],['PROOF','Optional checkpoint']]}
  ]},
  blocked:{name:'Limit reached',call:'20 / 20',cap:'180 / 512',approval:'Off',steps:[
    {title:'An agent sends a request.',copy:'The connected Research assistant asks AUVEN to make another OpenAI chat call.',icon:'◈',state:'REQUEST RECEIVED',focus:'agent',data:[['AGENT','Research assistant'],['ROUTE','OpenAI chat'],['REQUEST ID','Unique']]},
    {title:'AUVEN checks its identity.',copy:'The credential is valid and the agent is active. Identity alone does not grant permission to proceed.',icon:'◇',state:'IDENTITY VERIFIED',focus:'gate',data:[['IDENTITY','Registered'],['STATUS','Active'],['WORKSPACE','Matched']]},
    {title:'The daily cap blocks it.',copy:'The agent has already used all 20 calls allowed today. AUVEN denies this request before any provider call.',icon:'×',state:'DENIED',focus:'blocked',data:[['TODAY','20 of 20 calls'],['NEW REQUEST','Blocked'],['REASON','Request limit reached']]},
    {title:'OpenAI receives nothing.',copy:'The denied request is not forwarded. The agent gets a clear error and the workspace owner can adjust the policy if needed.',icon:'∅',state:'NOT SENT',focus:'blocked',data:[['PROVIDER','Not called'],['TOKENS','No new use'],['OWNER','Can change policy']]},
    {title:'The denial is recorded.',copy:'Activity shows which agent was blocked and why. The owner can include this decision in a later signed checkpoint.',icon:'▧',state:'RECORDED',focus:'gate',data:[['ACTIVITY','Denied'],['REASON','Request limit reached'],['PROOF','Optional checkpoint']]}
  ]},
  approval:{name:'Owner approval',call:'04 / 20',cap:'180 / 512',approval:'On',steps:[
    {title:'An agent sends a request.',copy:'The Research assistant sends a chat request with its credential. AUVEN knows which agent asked and which workspace owns it.',icon:'◈',state:'REQUEST RECEIVED',focus:'agent',data:[['AGENT','Research assistant'],['ROUTE','OpenAI chat'],['REQUEST ID','Unique']]},
    {title:'AUVEN checks the limits.',copy:'The agent is active and within its request, token, and estimated spending limits. Its policy also requires owner review.',icon:'◇',state:'POLICY CHECKED',focus:'gate',data:[['STATUS','Active'],['TODAY','04 of 20 calls'],['REVIEW','Required']]},
    {title:'The request waits for you.',copy:'It appears in Approvals with a preview. OpenAI has not received it. Choose a decision below to continue this simulation.',icon:'⌁',state:'AWAITING OWNER',focus:'gate',data:[['QUEUE','Approvals'],['PROVIDER','Not called'],['OWNER','Decision needed']]},
    {title:'Your decision takes effect.',copy:'',icon:'↗',state:'DECIDED',focus:'provider',data:[['DECISION','Owner reviewed'],['PROVIDER','Depends on decision'],['RESULT','Available to agent']]},
    {title:'The outcome is recorded.',copy:'Activity records the final decision. The agent can check the action status with its own credential.',icon:'▧',state:'RECORDED',focus:'gate',data:[['ACTIVITY','Decision logged'],['AGENT','Can check status'],['PROOF','Optional checkpoint']]}
  ]}
};

let scenario='allowed',step=0,review=null;
const stepsEl=document.querySelector('#demo-steps'),next=document.querySelector('#demo-next'),back=document.querySelector('#demo-back');
function setText(id,value){document.querySelector(id).textContent=value}
function render(){
  const current=scenarios[scenario],item=current.steps[step],isReview=scenario==='approval'&&step===2;
  document.querySelectorAll('[data-scenario]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.scenario===scenario)));
  stepsEl.innerHTML=current.steps.map((entry,index)=>`<li class="${index===step?'is-current':index<step?'is-done':''}"><span class="step-number">${index<step?'✓':String(index+1).padStart(2,'0')}</span><button type="button" data-step="${index}" ${index>step?'disabled':''}>${['Request','Identity','Policy','Execution','Record'][index]}</button></li>`).join('');
  stepsEl.querySelectorAll('[data-step]').forEach(button=>button.onclick=()=>{step=Number(button.dataset.step);render()});
  setText('#stage-count',`STEP ${String(step+1).padStart(2,'0')} / 05`);
  setText('#stage-title',item.title);
  let copy=item.copy;
  if(scenario==='approval'&&step===3)copy=review==='approve'?'You approved the saved request. AUVEN sends it to OpenAI and makes the result available to the agent.':'You denied the saved request. AUVEN does not call OpenAI; the agent receives a denied status.';
  if(scenario==='approval'&&step===4)copy=review==='approve'?'Activity records the approved call and provider result. A signed checkpoint remains an optional owner action.':'Activity records your denial and the provider is never called. A signed checkpoint remains an optional owner action.';
  setText('#stage-copy',copy);
  setText('#stage-icon',item.icon);
  let state=item.state;
  if(scenario==='approval'&&step>=3)state=review==='approve'?(step===3?'APPROVED':'RECORDED'):(step===3?'DENIED':'RECORDED');
  setText('#stage-state',state);
  const data=item.data.map(([label,value])=>[label,value]);
  if(scenario==='approval'&&step===3){data[0][1]=review==='approve'?'Approved':'Denied';data[1][1]=review==='approve'?'Called':'Not called';data[2][1]=review==='approve'?'Completed':'Denied'}
  if(scenario==='approval'&&step===4)data[0][1]=review==='approve'?'Allowed':'Denied';
  document.querySelector('#stage-data').innerHTML=data.map(([label,value])=>`<div><small>${label}</small><strong class="${/Denied|Blocked|Not called|reached/.test(value)?'bad':/Approved|Allowed|Active|Matched/.test(value)?'good':''}">${value}</strong></div>`).join('');
  for(const key of ['agent','gate','provider'])document.querySelector('#signal-'+key).className='';
  document.querySelector('#signal-'+(item.focus==='blocked'?'gate':item.focus)).className=item.focus==='blocked'||(scenario==='approval'&&step===3&&review==='deny')?'is-blocked':'is-active';
  const reviewButtons=document.querySelector('#stage-decision');reviewButtons.hidden=!isReview;
  reviewButtons.querySelectorAll('[data-review]').forEach(button=>{button.setAttribute('aria-pressed',String(review===button.dataset.review));button.style.opacity=review&&review!==button.dataset.review?'.45':'1'});
  back.disabled=step===0;
  next.disabled=isReview&&!review;
  next.innerHTML=step===4?'Run again <span aria-hidden="true">↻</span>':'Next step <span aria-hidden="true">→</span>';
}
document.querySelectorAll('[data-scenario]').forEach(button=>button.onclick=()=>{scenario=button.dataset.scenario;step=0;review=null;render()});
document.querySelectorAll('[data-review]').forEach(button=>button.onclick=()=>{review=button.dataset.review;render()});
back.onclick=()=>{if(step>0){step--;render()}};
next.onclick=()=>{if(step===4){step=0;review=null}else if(!(scenario==='approval'&&step===2&&!review))step++;render()};
render();
