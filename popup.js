"use strict";const UPDATE_KEY="pendingExtensionUpdate",currentVersion=chrome.runtime.getManifest().version,versionEl=document.getElementById("current-version"),badgeEl=document.getElementById("version-badge"),titleEl=document.getElementById("status-title"),messageEl=document.getElementById("status-message"),iconEl=document.getElementById("status-icon"),checkButton=document.getElementById("check-update"),buttonIcon=document.getElementById("button-icon"),buttonLabel=document.getElementById("button-label");function showCurrent(t="You already have the latest available version."){document.body.classList.remove("update-ready"),badgeEl.textContent="Current",iconEl.textContent="✓",titleEl.textContent="Up to date",messageEl.textContent=t,buttonIcon.textContent="↻",buttonLabel.textContent="Check again",checkButton.dataset.action="check"}function showUpdate(t){document.body.classList.add("update-ready"),badgeEl.textContent=`v${t}`,iconEl.textContent="↓",titleEl.textContent="Update ready",messageEl.textContent=`Version ${t} is ready. Apply it now to finish updating.`,buttonIcon.textContent="↑",buttonLabel.textContent="Apply update",checkButton.dataset.action="apply"}function showError(t){document.body.classList.remove("update-ready"),badgeEl.textContent="Notice",iconEl.textContent="!",titleEl.textContent="Could not check",messageEl.textContent=t,buttonIcon.textContent="↻",buttonLabel.textContent="Try again",checkButton.dataset.action="check"}async function checkForUpdate(){checkButton.disabled=!0,buttonIcon.textContent="…",buttonLabel.textContent="Checking…";try{const t=await chrome.runtime.requestUpdateCheck();"update_available"===t.status?showUpdate(t.version||"new"):"throttled"===t.status?showCurrent("The browser checked recently. It will check again automatically."):showCurrent()}catch(t){showError("Store update checks are unavailable for unpacked installations.")}finally{checkButton.disabled=!1}}versionEl.textContent=currentVersion,checkButton.addEventListener("click",()=>{if("apply"===checkButton.dataset.action)return chrome.runtime.sendMessage({type:"APPLY_EXTENSION_UPDATE"}),void window.close();checkForUpdate()}),chrome.storage.local.get(UPDATE_KEY).then(t=>{const e=t[UPDATE_KEY];e?.version&&showUpdate(e.version)});

// Restore only when Show menu is clicked; opening the popup preserves visibility.
const restoreButton = document.getElementById("restore-menu");
const panelMessage = document.getElementById("panel-message");
async function restoreMenu() {
  restoreButton.disabled = true;
  panelMessage.hidden = true;
  try {
    const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
    let supported = false;
    try {
      const url = new URL(tab?.url);
      supported = ["http:", "https:"].includes(url.protocol) &&
        (url.hostname === "skribbl.io" || url.hostname.endsWith(".skribbl.io"));
    } catch {}
    if (!supported || !Number.isInteger(tab?.id)) {
      panelMessage.textContent = "Open a Skribbl.io tab to show the menu.";
    } else {
      let restored = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const result = await chrome.tabs.sendMessage(tab.id, {type:"SG_PANEL_VISIBILITY", action:"restore"}, {frameId:0});
          if (result?.ok) {restored = true; break;}
        } catch {}
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 150));
      }
      panelMessage.textContent = restored ? "Menu shown. Your settings are preserved." :
        "Wait for the game page to finish loading, then try Show menu. Reload the page after an extension update.";
    }
  } catch {
    panelMessage.textContent = "Could not reach the game tab. Open Skribbl.io and try Show menu.";
  } finally {
    panelMessage.hidden = false;
    restoreButton.disabled = false;
  }
}
restoreButton.addEventListener("click", restoreMenu);
