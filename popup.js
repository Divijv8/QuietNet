document.addEventListener('DOMContentLoaded', async() => {
    const {websiteTime} = await chrome.storage.local.get('websiteTime');
    const timeChartCanvas = document.getElementById('timeChart');
    const totalTimeSpan = document.querySelector('#totalTime span');
    const websiteListDiv = document.getElementById('websiteList');

    
})