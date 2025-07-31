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

