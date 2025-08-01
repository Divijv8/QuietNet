const { chang } = require("wagmi/chains");

let activeTabId = null;
let activeDomain = null;
let startTime = null;

function getDomain(url){
    if(!url) return null;
    try{
        const urlObject = new URL(url);

        if(urlObject.protocol === 'chrome:'){
            return null; 
        }
        return urlObject.hostname;
    } catch(e){
        console.error('Could not fetch URL: ${url}', e);
        return null;
    }
}

async function stopTimer(){
    if(startTime && activeDomain){
        const endTime = new Date();
        const timeSpent = Math.round((endTime - startTime) / 1000); 

        if(timeSpent > 0){
            const data = await chrome.storage.local.get('websiteTime');
            const websiteTime = data.websiteTime || {};
            websiteTime[activeDomain] = (websiteTime[activeDomain] || 0) + timeSpent;
            await chrome.storage.local.set({websiteTime});
        }
    }
    activeDomain = null;
    startTime = null;
}

function startTimer(domain){
    if(domain){
        activeDomain = domain;
        startTime = new Date();
    }
}

// event listeners for tab updates

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await stopTimer();
    activeTabId = activeInfo.tabId;
    try{
        const tab = await chrome.tabs.get(activeTabId);
        if(tab && tab.url){
            const domain = getDomain(tab.url);
            if(domain){
                startTimer(domain);
            }
        }
    } catch(e){
        console.error('Error fetching tab info:', e);
    }
});

// On the tab update: URL int the active tab changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if(tabId === activeTabId && changeInfo.url){
        await stopTimer();
        const domain = getDomain(changeInfo.url);
        startTimer(domain);
    }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
    await stopTimer();

    if(windowId !== chrome.windows.WINDOW_ID_NONE){
        try{
            const [tab] = await chrome.tabs.query({active :true, windowId : windowId});
            if(tab){
                activeTabId = tab.id;
                const domain = getDomain(tab.url);
                startTimer(domain);
            }
        } catch(e){
            console.error('Error fetching focused tab:', e);
        }
    }
});

chrome.idle.onStateChanged.addListener(async (newState) => {
    if(newState === 'active'){
        try{
            const [tab] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
            if(tab){
                activeTabId = tab.id;
                const domain = getDomain(tab.url);
                startTimer(domain);
            }
        } catch(e) {
            console.error('Error fetching active tab on idle state change:', e);
        }
    } else {
        // user is idle or away, stop the timer
        await stopTimer();
    }
});

// Handling tab closure
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    if(tabId === activeTabId){
        await stopTimer();
        activeTabId = null; // Reset active tab ID
    }
});