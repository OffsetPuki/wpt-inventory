// Runs before the app bundle so a retired entry bundle still has a way back.
// Never reload automatically: the customer may have unsaved form changes.
window.addEventListener('error', function(event) {
  var target=event.target;
  if (!(target instanceof HTMLScriptElement) || !target.src.includes('/assets/')) return;
  var root=document.getElementById('root');
  if (!root || root.childElementCount) return;
  var message=document.createElement('p');
  message.textContent='The app could not finish loading. Check your connection, then reload to get the current version.';
  var button=document.createElement('button');
  button.type='button'; button.textContent='Reload app'; button.onclick=function(){window.location.reload();};
  root.setAttribute('role','alert'); root.style.cssText='max-width:36rem;margin:15vh auto;padding:2rem;font:16px system-ui';
  button.style.cssText='padding:.8rem 1.2rem;cursor:pointer'; root.append(message,button);
},true);
