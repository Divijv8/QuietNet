document.addEventListener('DOMContentLoaded', async () => {
    const { websiteTime, visitedDomains } = await chrome.storage.local.get(['websiteTime', 'visitedDomains']);
    const timeChartCanvas = document.getElementById('timeChart');
    const totalTimeSpan = document.querySelector('#totalTime span');
    const websiteListDiv = document.getElementById('websiteList');
    const visitedSitesCountSpan = document.getElementById('websitesVisitedCount');

    // Set number of unique websites visited
    const visitedCount = visitedDomains ? Object.keys(visitedDomains).length : 0;
    if (visitedSitesCountSpan) {
        visitedSitesCountSpan.textContent = visitedCount;
    }

    if (websiteTime && Object.keys(websiteTime).length > 0) {
        const labels = Object.keys(websiteTime);
        const data = Object.values(websiteTime);
        const totalMinutes = Math.round(data.reduce((a, b) => a + b, 0) / 60);

        totalTimeSpan.textContent = `${totalMinutes} minutes`;

        // Sort data for display list
        const sortedWebsites = Object.entries(websiteTime)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5); // Display top 5

        websiteListDiv.innerHTML = '<h4>Top Websites</h4>';
        const list = document.createElement('ul');
        sortedWebsites.forEach(([domain, time]) => {
            const listItem = document.createElement('li');
            const domainSpan = document.createElement('span');
            domainSpan.textContent = domain;
            const timeSpan = document.createElement('span');
            timeSpan.textContent = `${Math.round(time / 60)} min`;
            listItem.appendChild(domainSpan);
            listItem.appendChild(timeSpan);
            list.appendChild(listItem);
        });
        websiteListDiv.appendChild(list);

        // Pie Chart
        new Chart(timeChartCanvas, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Time Spent (seconds)',
                    data: data,
                    backgroundColor: [
                        '#4285F4', // Google Blue
                        '#DB4437', // Google Red
                        '#F4B400', // Google Yellow
                        '#0F9D58', // Google Green
                        '#E91E63', // Pink
                        '#9C27B0', // Purple
                    ],
                    borderWidth: 0,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '75%',
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed !== null) {
                                    label += `${Math.round(context.parsed / 60)} minutes`;
                                }
                                return label;
                            }
                        }
                    }
                }
            }
        });

    } else {
        totalTimeSpan.textContent = '0 minutes';
        websiteListDiv.innerHTML = '<p>No browsing data yet. Start surfing!</p>';
    }
});