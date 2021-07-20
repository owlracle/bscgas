// set the cookie utils object

const cookies = {
    set: function(key, value, {expires, path}={}) {
        if (!expires){
            expires = 86400000;
        }
        if (!path){
            path = '/';
        }

        let expTime = 0;
        if (typeof expires === "object"){
            expTime += (expires.seconds * 1000) || 0;
            expTime += (expires.minutes * 1000 * 60) || 0;
            expTime += (expires.hours * 1000 * 60 * 60) || 0;
            expTime += (expires.days * 1000 * 60 * 60 * 24) || 0;
        }
        else {
            expTime = expires;
        }

        const now = new Date();
        expTime = now.setTime(now.getTime() + expTime);

        const cookieString = `${key}=${value};expires=${new Date(expTime).toUTCString()};path=${path}`;
        document.cookie = cookieString;
        return cookieString;
    },

    get: function(key) {
        const cookies = document.cookie.split(';').map(e => e.trim());
        const match = cookies.filter(e => e.split('=')[0] == key);
        return match.length ? match[0].split('=')[1] : false;
    },

    delete: function(key) {
        const cookies = document.cookie.split(';').map(e => e.trim());
        const match = cookies.filter(e => e.split('=')[0] == key);

        document.cookie = `${key}=0;expires=${new Date().toUTCString()}`;
        return match.length > 0;
    }
};


const chart = {
    package: import('https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js'),
    ready: false,
    timeframe: 60,
    page: 1,
    candles: 1000,
    lastCandle: new Date().getTime() / 1000,
    allRead: false,

    init: async function() {
        await this.package;

        this.obj = LightweightCharts.createChart(document.querySelector('#chart'), {
            width: Math.min(document.querySelector('#frame').offsetWidth - 20, 600),
            height: 300,
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
            },
        });

        window.addEventListener('resize', () => {
            this.obj.resize(Math.min(document.querySelector('#frame').offsetWidth - 20, 600), 300);
        });
    
        this.series = {
            instant: { color: '#ff0000' },
            fast: { color: '#ff00ff' },
            standard: { color: '#0000ff' },
            slow: { color: '#00ff00' },
        };
        
        // set speed buttons behaviour
        Object.entries(this.series).forEach(([key, value]) => {
            document.querySelector(`#toggle-container #${key}`).addEventListener('click', async function() {
                this.classList.toggle('active');
                value.visible = this.classList.contains('active');
    
                if (value.series){
                    value.series.applyOptions({
                        visible: value.visible
                    });
                }
            });
        });
    
        const container = document.querySelector('#chart');
        const toolTip = document.createElement('div');
        toolTip.id = 'tooltip-chart';
        container.appendChild(toolTip);
    
        this.obj.subscribeCrosshairMove(param => {
            const s = Object.keys(this.series).map(e => this.series[e].series);
            if (param.point === undefined || !param.time || param.point.x < 0 || param.point.x > container.clientWidth || param.point.y < 0 || param.point.y > container.clientHeight) {
                toolTip.style.display = 'none';
            }
            else {
                toolTip.style.display = 'block';
    
                toolTip.innerHTML = Object.keys(this.series).filter(e => this.series[e].visible).map(e => {
                    const price = param.seriesPrices.get(this.series[e].series);
                    const key = e.charAt(0).toUpperCase() + e.slice(1);
                    return `<div class="${key.toLowerCase()}">${key}: ${price}</div>`;
                }).join('');
    
                const coordinateY = container.offsetTop + 10;
                const coordinateX = container.offsetLeft + 10;
    
                toolTip.style.left = `${coordinateX}px`;
                toolTip.style.top = `${coordinateY}px`;
            }
        });

        document.querySelectorAll('#timeframe-switcher button').forEach(b => b.addEventListener('click', async () => {
            const history = await this.getHistory(b.id.split('tf-')[1]);
            document.querySelectorAll('#timeframe-switcher button').forEach(e => e.classList.remove('active'));
            b.classList.add('active')
            this.update(history);

            document.querySelectorAll(`#toggle-container button`).forEach(b => {
                const series = this.series[b.id];
                if (series.visible){
                    series.series.applyOptions({
                        visible: series.visible
                    });
                }
            });
        }));

        this.timeScale = this.obj.timeScale();
    
        this.timeScale.subscribeVisibleLogicalRangeChange(async () => {
            const logicalRange = this.timeScale.getVisibleLogicalRange();
            if (logicalRange !== null && logicalRange.from < 0 && this.history.length >= this.candles && !this.scrolling && !this.allRead) {
                this.scrolling = true;
                const oldHistory = this.history;
                const newHistory = await this.getHistory(this.timeframe, this.page + 1);
                this.history = [...oldHistory, ...newHistory];

                this.update(this.history);
                console.log(this.history);
                this.page++;
                this.scrolling = false;

                if (newHistory.length == 0){
                    this.allRead = true;
                }
            }
        });

        this.ready = true;

        return;
    },

    update: function(data) {
        // console.log(data);
        Object.entries(this.series).forEach(([key, value]) => {
            const speedData = data.map(e => { return { 
                value: e[key].high,
                time: parseInt(new Date(e.timestamp).getTime() / 1000),
            }}).reverse();
    
            // [{ time: '2018-10-19', open: 180.34, high: 180.99, low: 178.57, close: 179.85 },]
            if (!value.series){
                value.series = this.obj.addAreaSeries({
                    lineColor: value.color,
                    topColor: value.color,
                    bottomColor: `${value.color}30`,
                    lineWidth: 2,
                    visible: false,
                });
            }
            value.series.setData(speedData);
        });
    },

    setTheme: function(name) {
        let background = '#232323';
        let text = '#e3dcd0';
        let lines = '#3c3c3c';

        if (name == 'light'){
            background = '#eeeeee';
            text = '#511814';
            lines = '#c9c9c9';
        }

        this.isReady().then(() => {
            this.obj.applyOptions({
                layout: {
                    backgroundColor: background,
                    textColor: text,
                },
                grid: {
                    vertLines: { color: lines },
                    horzLines: { color: lines },
                },
                rightPriceScale: { borderColor: lines },
                timeScale: { borderColor: lines },
            });
        });
    },

    getHistory: async function(timeframe=60, page=1) {
        this.timeframe = timeframe;
        this.history = await (await fetch(`/history?timeframe=${timeframe}&page=${page}&candles=${this.candles}&to=${this.lastCandle}`)).json();
        return this.history;
    },

    isReady: async function() {
        return this.ready || new Promise(resolve => setTimeout(() => resolve(this.isReady()), 10));
    }
};
chart.init().then(() => {
    document.querySelector(`#timeframe-switcher #tf-60`).click();
    document.querySelector(`#toggle-container #standard`).click();
});


// change theme dark/light

const theme = {
    options: ['dark', 'light'],
    icons: {
        dark: 'sun',
        light: 'moon'
    },
    choice: 'dark',

    set: function(name){
        if (this.options.includes(name)){
            const oldName = this.choice;
            document.body.classList.remove(this.choice);
            document.body.classList.add(name);
            this.choice = name;
            cookies.set('theme', name, { expires: { days: 365 } });
            document.querySelector('header #theme').innerHTML = `<i class="fas fa-${this.icons[name]}"></i>`;
            chart.setTheme(name);

            if (oldName != name && window.__CPEmbed){
                document.querySelector('#codepen').innerHTML = codepenEmbed.split('{{THEME}}').join(name);
                window.__CPEmbed("#codepen .codepen");
            }
        }
    },

    load: function() {
        this.set(cookies.get('theme') || this.choice);
    },

    toggle: function() {
        const index = this.options.indexOf(this.choice);
        const next = this.options[ (index + 1) % this.options.length ];
        this.set(next);
    },

    get: function() {
        return this.choice;
    }
};

theme.load();
document.querySelector('#theme').addEventListener('click' , () => theme.toggle());


// fetch bnb price from binance and update the pages's ticker

const price = {
    current: 0,
    element: document.querySelector('#price'),

    get: async function() {
        const url = `https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT`;
        const url24 = `https://api.binance.com/api/v3/ticker/24hr?symbol=BNBUSDT`;

        const price = (await (await fetch(url)).json()).price;
        const price24h = (await (await fetch(url24)).json()).priceChangePercent;

        return {
            now: parseFloat(price).toFixed(2),
            changePercent: parseFloat(price24h).toFixed(2), 
        }
    },

    update: async function() {
        this.current = await this.get();

        if (this.current.changePercent < 0){
            this.element.querySelector('#color').classList.remove('green');
            this.element.querySelector('#color').classList.add('red');
        }
        else {
            this.element.querySelector('#color').classList.remove('red');
            this.element.querySelector('#color').classList.add('green');
            this.current.changePercent = `+${this.current.changePercent}`;
        }

        this.element.querySelector('#now').innerHTML = this.current.now;
        this.element.querySelector('#before').innerHTML = this.current.changePercent;
    }
};

price.update();
setInterval(() => price.update(), 10000); // update every 10s


// open a bscscan search window

document.querySelector('#search button').addEventListener('click', bscScanSearch);
document.querySelector('#search input').addEventListener('keyup', e => {
    if (e.key == 'Enter'){
        bscScanSearch();
    }
});

function bscScanSearch() {
    const input = document.querySelector('#search input');
    const url = `https://bscscan.com/search?q=`;

    if (input.value.length > 0){
        window.open(`${url}${input.value}`);
    }
    input.value = '';
}


// create modal about donation

const wallet = {
    address: '0xA6E126a5bA7aE209A92b16fcf464E502f27fb658',

    loadImg: async function(elem) {
        return new Promise(resolve => {
            this.img = new Image();
            const url = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=`;

            this.shortAddress = `${this.address.slice(0,6)}...${this.address.slice(-4)}`;
            elem.querySelector('#wallet').innerHTML = `<span class="long">${this.address}</span><span class="short">${this.shortAddress}</span>`;

            this.img.src = `${url}${this.address}`;
    
            this.img.onload = () => {
                elem.classList.remove('disabled');
                elem.addEventListener('click', () => this.showModal());
                resolve(this.img)
            };
        });
    },

    bindModal: function(elem) {
        elem.addEventListener('click', () => this.showModal());
    },

    showModal: function(){
        const fog = document.createElement('div');
        fog.id = 'fog';
        fog.innerHTML = `<div id='donate-window'>
            <div id="title">
                <span>Binance Smart Chain (BSC)</span>
                <span class="big">BNB Wallet</span>
            </div>
            <div id="qr"><img></div>
            <div id="colored">
                <div id="wallet-container">
                    <div id="wallet"></div>
                    <div id="copy"><i class="far fa-copy"></i></div>
                </div>
            </div>
        </div>`;

        fog.addEventListener('click', () => fog.remove());
        fog.querySelector('div').addEventListener('click', e => e.stopPropagation());
    
        fog.querySelector('img').src = this.img.src;
        fog.querySelector('#wallet').innerHTML = this.shortAddress;
    
        fog.querySelector('#wallet-container').addEventListener('click', () => this.copyAddress());

        document.body.appendChild(fog);
        fadeIn(fog, 500);
    },

    copyAddress: function(){
        const elem = document.querySelector('#fog #wallet');
        const oldText = elem.innerHTML;
        elem.innerHTML = `COPIED`;

        const container = document.querySelector('#fog #wallet-container');
        container.classList.add('copy');

        setTimeout(() => {
            elem.innerHTML = oldText;
            container.classList.remove('copy');
        }, 500);

        navigator.clipboard.writeText(this.address);
    }
};
wallet.loadImg(document.querySelector('#donate'));
document.querySelectorAll('.donate-link').forEach(e => wallet.bindModal(e));


// fade in and out function (work on any element)

async function fadeIn(elem, time=300){
    return new Promise(resolve => {
        const oldStyle = elem.getAttribute('style');
        elem.style.transition = `${time/1000}s opacity`;
        elem.style.opacity = '0';
    
        setTimeout(() => elem.style.opacity = '1', 1);
        setTimeout(() => {
            elem.removeAttribute('style');
            elem.style = oldStyle;
            resolve(true);
        }, time + 100);
    });
}

async function fadeOut(elem, time=300){
    return new Promise(resolve => {
        elem.style.transition = `${time/1000}s opacity`;
        
        setTimeout(() => elem.style.opacity = '0', 1);
        setTimeout(() => {
            elem.remove();
            resolve(true);
        }, time + 100);
    });
}


// tooltip class

class Tooltip {
    constructor(parent, text, {
        createEvent= 'click',
        killEvent= 'mouseleave',
        timeout= null
    }={}) {
        this.parent = parent;
        this.text = text;

        this.parent.addEventListener(createEvent, e => {
            this.create(e);

            if (timeout){
                setTimeout(() => this.kill(), timeout);
            }    
        });

        if (killEvent == 'mouseleave') {
            this.parent.addEventListener(killEvent, () => this.kill());
        }


        return this;
    }

    create(event) {
        // console.log(event);
        const tooltip = document.createElement('div');
        this.element = tooltip;
        tooltip.classList.add('tooltip');
        tooltip.innerHTML = this.text;
        tooltip.style.top = `${event.y}px`;
        tooltip.style.left = `${event.x}px`;

        document.querySelectorAll('.tooltip').forEach(e => e.remove());

        this.parent.insertAdjacentElement('afterend', tooltip);
        fadeIn(tooltip, 200);
    }

    kill() {
        if (this.element){
            fadeOut(this.element, 200);
        }
    }

    setText(text) {
        this.text = text;
    }
}


// show tooltips for each gas speed card

const tooltipList = [
    'Accepted on 35% of blocks',
    'Accepted on 60% of blocks',
    'Accepted on 90% of blocks',
    'Accepted on every block',
];
document.querySelectorAll('.gas i').forEach((e,i) => {
    new Tooltip(e, tooltipList[i]);
});

// update gas prices every 10s

const gasTimer = {
    interval: 10000,
    toInterval: 100,
    counter: 100,
    element: document.querySelector('#countdown #filled'),

    init: function(interval, toInterval){
        this.interval = interval;
        this.toInterval = toInterval;
        this.counter = interval / toInterval;

        this.countDown();
    },

    countDown: function() {
        setTimeout(() => {
            this.counter--;
            this.element.style.width = `${this.counter / (this.interval / this.toInterval) * 100}%`;
        
            if (this.counter <= 0){
                this.counter = this.interval / this.toInterval;
                this.update().then(() => this.countDown());
            }
            else {
                this.countDown();
            }
        }, this.toInterval);
    },

    update: async function() {
        const startTime = new Date();
        // --- NOTICE ---.
        // This endpoint returns a cached information retieved from oracle every 30 seconds.
        // There is no point in making your app consume this endpoint as a way to overcome the api limits. You will be getting "old" data.
        // Instead, use your own api key every 30-60 seconds, cache the response in your server, then deliver to your users when they request your server. Check the api request limits and you will be able to keep using this service for free.
        // Check the docs for more info.
        const data = await (await fetch('/gascached')).json();
        const requestTime = new Date() - startTime;

        const speedList = ['slow', 'standard', 'fast', 'instant'];
        if (data.error){
            console.log(data.error);
        }
        else{
            document.querySelectorAll('.gas .body').forEach((e,i) => {
                if (data[speedList[i]]){
                    e.innerHTML = `${data[speedList[i]]} GWei`;
                }
            });

            setColorGradient(document.querySelector('#time-sign'), requestTime);
        }
        return data;    
    }
};
gasTimer.init(30000, 100);

gasTimer.update().then(data => {
    const formatted = `{
    <span class="json key">"timestamp"</span>: <span class="json string">"${data.timestamp || ''}"</span>,
    <span class="json key">"slow"</span>: <span class="json number">${data.slow || 0}</span>,
    <span class="json key">"standard"</span>: <span class="json number">${data.standard || 0}</span>,
    <span class="json key">"fast"</span>: <span class="json number">${data.fast || 0}</span>,
    <span class="json key">"instant"</span>: <span class="json number">${data.instant || 0}</span>
    <span class="json key">"block_time"</span>: <span class="json number">${data.block_time || 0}</span>
    <span class="json key">"last_block"</span>: <span class="json number">${data.last_block || 0}</span>
}`;

    document.querySelector('#sample').innerHTML = formatted;
});

const tooltipColor = new Tooltip(document.querySelector('#time-sign'), '', { createEvent: 'mouseenter' });

function setColorGradient(elem, time){
    const maxTime = 10000;
    const rate = Math.min(time, maxTime) / maxTime;

    const color = {b: '00', toString: color => '00'.slice(color.toString(16).length) + color.toString(16)};
    color.r = color.toString(Math.round(rate * 200));
    color.g = color.toString(Math.round((1 - rate) * 200));

    elem.style['background-color'] = `#${color.r}${color.g}${color.b}`;
    tooltipColor.setText(`API took ${(time/1000).toFixed(2)}s to respond`);

}

const codepenEmbed = `<p class="codepen" data-height="265" data-theme-id="{{THEME}}" data-default-tab="js,result" data-user="pswerlang" data-slug-hash="GRWQzzR" style="height: 265px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border: 2px solid; margin: 1em 0; padding: 1em;" data-pen-title="BSC gas price sample code"><span>See the Pen <a href="https://codepen.io/pswerlang/pen/GRWQzzR">BSC gas price sample code</a> by Pablo (<a href="https://codepen.io/pswerlang">@pswerlang</a>) on <a href="https://codepen.io">CodePen</a>.</span></p>`;
document.querySelector('#codepen').innerHTML = codepenEmbed.split('{{THEME}}').join(theme.get());
import('https://cpwebassets.codepen.io/assets/embed/ei.js');


// post method for testing purposes
// window.post = async function(url, args) {
//     const response = await fetch(url, {
//         method: args.method || 'POST',
//         body: JSON.stringify(args),
//         headers: { 'Content-Type': 'application/json' }
//     });
//     return response.json();
// }

const api = {
    regex: {
        url: new RegExp(/^(?:https?:\/\/)?(?:www\.)?([a-z0-9._-]{1,256}\.[a-z0-9]{1,6})\b.*$/),
        apiKey: new RegExp(/^[a-f0-9]{32}$/),
    },

    createNewApiContent: function(){
        // create api key modal
        const tabsContent = this.tabsContent;
        tabsContent.create.innerHTML = `<h2>New API key</h2>
        <p class="title origin">Origin <i class="far fa-question-circle"></i></p>
        <input type="text" class="input-text" id="origin" placeholder="mywebsite.com">
        <span id="origin-tip" class="tip"></span>
        <p class="title note">Note <i class="far fa-question-circle"></i></p>
        <input type="text" class="input-text" id="note" placeholder="My personal note for this key">
        <div id="checkbox-container">
            <label>
                <input type="checkbox">
                <span>I agree to not share any of my API key information with others.</span>
            </label>
            <label>
                <input type="checkbox">
                <span>I am aware that front-end code is publicly readable and exposing my API key on it is the same as sharing them.</span>
            </label>
        </div>
        <div id="button-container"><button id="create-key" disabled>Create API key</button></div>`;
                
        tabsContent.create.querySelectorAll('#checkbox-container input').forEach(e => e.addEventListener('click', () => {
            if (Array.from(tabsContent.create.querySelectorAll('#checkbox-container input')).filter(e => e.checked).length == 2){
                tabsContent.create.querySelector('#create-key').removeAttribute('disabled');
            }
            else {
                tabsContent.create.querySelector('#create-key').setAttribute('disabled', true);
            }
        }));


        const urlRegex = this.regex.url;
        tabsContent.create.querySelector('#origin').addEventListener('keyup', () => {
            const value = tabsContent.create.querySelector('#origin').value.trim().toLowerCase();
            const match = value.match(urlRegex);
            if (match && match.length > 1){
                const tip = tabsContent.create.querySelector('#origin-tip');
                tip.innerHTML = '';
                tabsContent.create.querySelector('#origin').classList.remove('red');
            }
        });

        tabsContent.create.querySelector('#create-key').addEventListener('click', async function() {
            const body = {};
            let error = false;
            if (tabsContent.create.querySelector('#origin').value.length){
                // make sure origin informed is only then domain name
                const value = tabsContent.create.querySelector('#origin').value.trim().toLowerCase();
                const match = value.match(urlRegex);
                if (match && match.length > 1){
                    body.origin = value;
                }
                else{
                    const tip = tabsContent.create.querySelector('#origin-tip');
                    tip.innerHTML = 'Invalid domain';
                    tabsContent.create.querySelector('#origin').classList.add('red');
                    error = true;
                }
            }
            if (tabsContent.create.querySelector('#note').value.length){
                body.note = tabsContent.create.querySelector('#note').value.trim();
            }

            if (!error){
                this.setAttribute('disabled', true);
                this.innerHTML = '<i class="fas fa-spin fa-cog"></i>';
    
                const data = await api.createKey(body);
                api.showWindowCreate(data);
            }
        });
    },

    createEditApiContent: function(){
        // edit api key modal
        const tabsContent = this.tabsContent;
        tabsContent.edit.innerHTML = `<h2>Edit API key</h2>
        <p class="title">API Key</p>
        <input type="text" class="input-text" id="key" placeholder="00000000000000000000000000000000">
        <span id="key-tip" class="tip"></span>
        <p class="title">API Secret</p>
        <input type="text" class="input-text" id="secret" placeholder="00000000000000000000000000000000">
        <span id="secret-tip" class="tip"></span>
        <p class="title origin">Origin <i class="far fa-question-circle"></i></p>
        <input type="text" class="input-text" id="origin" placeholder="mywebsite.com">
        <span id="origin-tip" class="tip"></span>
        <p class="title note">Note <i class="far fa-question-circle"></i></p>
        <input type="text" class="input-text" id="note" placeholder="My personal note for this key">
        <div id="checkbox-container">
            <label>
                <input type="checkbox">
                <span>
                    <div>I want to reset my API key hash</div>
                    <div class='tip hidden'>WARNING: The current API key hash will not be usable anymore.</div>
                </span>
            </label>
        </div>
        <div id="button-container"><button id="edit-key">Save</button></div>`;

        const urlRegex = this.regex.url;
        const apiKeyRegex = this.regex.apiKey;

        tabsContent.edit.querySelector('#origin').addEventListener('keyup', function() {
            const value = this.value.trim().toLowerCase();
            const match = value.match(urlRegex);
            if (match && match.length > 1){
                const tip = tabsContent.edit.querySelector('#origin-tip');
                tip.innerHTML = '';
                tabsContent.edit.querySelector('#origin').classList.remove('red');
            }
        });

        tabsContent.edit.querySelectorAll('#key, #secret').forEach(e => e.addEventListener('keyup', function() {
            const value = this.value.trim().toLowerCase();
            if (value.match(apiKeyRegex)){
                const tip = tabsContent.edit.querySelector(`#${this.id}-tip`);
                tip.innerHTML = '';
                this.classList.remove('red');
            }
        }));

        tabsContent.edit.querySelector('#checkbox-container input').addEventListener('change', function() {
            const tip = this.parentNode.querySelector('.tip');
            if (this.checked){
                tip.classList.remove('hidden');
            }
            else{
                tip.classList.add('hidden');
            }
        });

        tabsContent.edit.querySelector('#edit-key').addEventListener('click', async function() {
            const body = {};
            let error = false;
            if (tabsContent.edit.querySelector('#origin').value.length){
                // make sure origin informed is only then domain name
                const value = tabsContent.edit.querySelector('#origin').value.trim().toLowerCase();
                const match = value.match(urlRegex);
                if (match && match.length > 1){
                    body.origin = value;
                }
                else{
                    const tip = tabsContent.edit.querySelector('#origin-tip');
                    tip.innerHTML = 'Invalid domain';
                    tabsContent.edit.querySelector('#origin').classList.add('red');
                    error = true;
                }
            }
            if (tabsContent.edit.querySelector('#note').value.length){
                body.note = tabsContent.edit.querySelector('#note').value.trim();
            }

            const key = tabsContent.edit.querySelector('#key').value.trim().toLowerCase();
            if (!key.match(apiKeyRegex)){
                const tip = tabsContent.edit.querySelector('#key-tip');
                tip.innerHTML = 'Invalid API key';
                tabsContent.edit.querySelector('#key').classList.add('red');
                error = true;
            }

            body.secret = tabsContent.edit.querySelector('#secret').value.trim().toLowerCase();
            if (!body.secret.match(apiKeyRegex)){
                const tip = tabsContent.edit.querySelector('#secret-tip');
                tip.innerHTML = 'Invalid API secret';
                tabsContent.edit.querySelector('#secret').classList.add('red');
                error = true;
            }

            const reset = tabsContent.edit.querySelector('#checkbox-container input').checked;
            if (reset){
                body.resetKey = true;
            }


            if (!error){
                this.setAttribute('disabled', true);
                this.innerHTML = '<i class="fas fa-spin fa-cog"></i>';
    
                const data = await api.editKey(key, body);
                api.showWindowEdit(data);
            }
        });
    },

    createInfoApiContent: function(){
        // get api key information
        const tabsContent = this.tabsContent;
        tabsContent.info.innerHTML = `<h2>API key information</h2>
        <p class="title">API key</p>
        <input type="text" class="input-text" id="key" placeholder="00000000000000000000000000000000">
        <span id="key-tip" class="tip"></span>
        <div id="button-container"><button id="get-key">Search</button></div>`;

        tabsContent.info.querySelector('#key').addEventListener('keyup', function() {
            const value = this.value.trim().toLowerCase();
            if (value.match(apiKeyRegex)){
                const tip = tabsContent.info.querySelector(`#key-tip`);
                tip.innerHTML = '';
                this.classList.remove('red');
            }
        });

        const apiKeyRegex = this.regex.apiKey;

        tabsContent.info.querySelector('#get-key').addEventListener('click', async function() {
            let error = false;

            const key = tabsContent.info.querySelector('#key').value.trim().toLowerCase();
            if (!key.match(apiKeyRegex)){
                const tip = tabsContent.info.querySelector('#key-tip');
                tip.innerHTML = 'Invalid API key';
                tabsContent.info.querySelector('#key').classList.add('red');
                error = true;
            }

            if (!error){
                this.setAttribute('disabled', true);
                this.innerHTML = '<i class="fas fa-spin fa-cog"></i>';

                const data = await api.getKey(key);
                api.showWindowInfo(data);
            }
        });
    },

    showWindowCreate: function(data){
        const modal = document.querySelector('#fog #api-window');
        if (data.apiKey){
            modal.innerHTML = `<div id="content">
                <h2>API key Created</h2>
                <p class="title">API Key</p>
                <div class="copy-container">
                    <input type="text" class="input-text keys" value="${data.apiKey}" readonly>
                    <div class="copy"><i class="far fa-copy"></i></div>
                </div>
                <p class="title">API Secret</p>
                <div class="copy-container">
                    <input type="text" class="input-text keys" value="${data.secret}" readonly>
                    <div class="copy"><i class="far fa-copy"></i></div>
                </div>
                <p class="title">Wallet</p>
                <div class="copy-container">
                    <input type="text" class="input-text keys" value="${data.wallet}" readonly>
                    <div class="copy"><i class="far fa-copy"></i></div>
                </div>
                <ul>
                    <li>Make sure to save this information before closing this window.</li>
                    <li>We do not store your key and secret in plain text, so we cannot recover them in case of loss.</li>
                </ul>
                <div id="button-container"><button id="close">OK</button></div>
            </div>`;
            // add buttons for clipboard copy info

            modal.querySelector('#close').addEventListener('click', () => modal.parentNode.remove());

            modal.querySelectorAll('.copy').forEach(e => e.addEventListener('click', function(){
                const parent = this.closest('.copy-container');
                api.copyText(parent);
            }));
        }
        else{
            modal.innerHTML = `<div id="content">
                <h2>${data.error || 'Message'}</h2>
                <p>${data.message}</p>
                <div id="button-container"><button id="close">OK</button></div>
            </div>`;
        }
    },

    showWindowEdit: function(data){
        const modal = document.querySelector('#fog #api-window');
        if (data.apiKey){
            const fields = Object.entries(data).filter(e => e[0] != 'apiKey' && e[0] != 'message').map(e => `<p class="title">${e[0]}</p><input type="text" class="input-text keys" value="${e[1]}" readonly>`).join('');

            modal.innerHTML = `<div id="content">
                <h2>API key information updated</h2>
                <p class="title">API Key</p>
                <input type="text" class="input-text keys" value="${data.apiKey}" readonly>
                ${fields}
                <div id="button-container"><button id="close">OK</button></div>
            </div>`;
        }
        else{
            modal.innerHTML = `<div id="content">
                <h2>${data.error || 'Message'}</h2>
                <p>${data.message}</p>
                <div id="button-container"><button id="close">OK</button></div>
            </div>`;
        }

        modal.querySelector('#close').addEventListener('click', () => modal.parentNode.remove());
    },

    showWindowInfo: function(data) {
        const modal = document.querySelector('#fog #api-window');
        if (data.apiKey){
            const key = data.apiKey;
            const fields = Object.entries(data).filter(e => e[0] != 'usage').map(e => {
                const label = e[0] == 'apiKey' ? 'API Key' : e[0];

                let value = e[1];
                if (e[0] == 'credit') {
                    value = `...`;
                }
                else if (e[0] == 'creation'){
                    value = new Date(e[1]).toISOString().replace('T', ' ').split('.')[0];
                }

                let input = `<input type="text" class="input-text keys" id="input-${label}" value="${value}" readonly>`;
                if (e[0] == 'wallet'){
                    input = `<div class="copy-container">${input}<div class="copy"><i class="far fa-copy"></i></div></div>`;
                }
                return `<p class="title">${label}</p>${input}`;
            }).join('');

            modal.innerHTML = `<div id="content">
                <h2>API key information</h2>
                ${fields}
                <div id="button-container">
                    <button id="credit">History</button>
                    <button id="close">Close</button>
                </div>
            </div>`;

            modal.querySelector('.copy').addEventListener('click', function(){
                const parent = this.closest('.copy-container');
                api.copyText(parent);
            });

            modal.querySelector('#credit').addEventListener('click', async () => {
                const data = await this.getCredit(key);
                this.showWindowCredit(key, data);
            });    

            async function refreshCredit(key){
                const modal = document.querySelector('#fog #api-window');
                if (modal && modal.querySelector('#input-credit')){
                    await api.updateCredit(key);
                    const data = await api.getKey(key);

                    // if even after await you are still on the same window
                    if (modal && modal.querySelector('#input-credit')){
                        modal.querySelector('#input-credit').value = `${(data.credit / 100000000).toFixed(8)} BNB`;
                        setTimeout(() => refreshCredit(key), 5000);
                    }
                }
            }
            refreshCredit(key);
        }
        else{
            modal.innerHTML = `<div id="content">
                <h2>${data.error || 'Message'}</h2>
                <p>${data.message}</p>
                <div id="button-container"><button id="close">OK</button></div>
            </div>`;
        }

        modal.querySelector('#close').addEventListener('click', () => document.querySelector('#fog').remove());
    },

    showWindowCredit: function(key, data) {
        const modal = document.querySelector('#fog #api-window');

        let txs = '<div class="empty">No transactions found. Try sending some BNB to your API wallet.</div>';
        if (data.results.length > 0){
            modal.classList.add('large');

            const tds = data.results.map(e => {
                return `<div class="row">
                    <div class="cell"><a href="https://bscscan.com/tx/${e.tx}" target="_blank">${e.tx.slice(0,6)}...${e.tx.slice(-4)}</a></div>
                    <div class="cell">${new Date(e.timestamp).toISOString().replace('T', ' ').split('.')[0]}</div>
                    <div class="cell"><a href="https://bscscan.com/address/${e.fromWallet}" target="_blank">${e.fromWallet.slice(0,6)}...${e.fromWallet.slice(-4)}</a></div>
                    <div class="cell">${(e.value / 100000000).toFixed(8)}</div>
                </div>`;
            }).join('');
            txs = `<div class="row head">
                <div class="cell">Tx</div>
                <div class="cell">Time</div>
                <div class="cell">From wallet</div>
                <div class="cell">Value (BNB)</div>
            </div>
            <div class="body">${tds}</div>`;
        }
        txs = `<div class="table">${txs}</div>`;
        
        modal.innerHTML = `<div id="content">
            <h2>API recharge history</h2>
            <p id="key-show">${key}</p>
            ${txs}
            <p id="missing">Missing tx? <a href="https://t.me/bscgas_info" target="_blank">contact us</a>!</p>
            <div id="button-container"><button id="close">Close</button></div>
        </div>`;
        
        modal.querySelector('#close').addEventListener('click', () => document.querySelector('#fog').remove());
    },

    showModal: function(){
        const fog = document.createElement('div');
        fog.id = 'fog';
        fog.innerHTML = `<div id='api-window'>
            <div id='tab-container'>
                <div class="tab" id="info"><i class="fas fa-eye"></i><span class="text">Key Info</span></div>
                <div class="tab" id="edit"><i class="fas fa-edit"></i><span class="text">Edit Key</span></div>
                <div class="tab" id="create"><i class="fas fa-plus"></i><span class="text">Create Key</span></div>
                <div class="tab" id="close-tab"><i class="fas fa-times"></i></div>
            </div>
            <div id='content'></div>
        </div>`;

        const tabsContent = Object.fromEntries(['info', 'edit', 'create'].map(e => [e, (() => {
            const elem = document.createElement('div');
            elem.id = 'content';
            return elem;
        })()]));
        this.tabsContent = tabsContent;

        fog.querySelectorAll('.tab').forEach(e => e.addEventListener('click', () => {
            if (e.id == 'close-tab'){
                fog.click();
            }
            else{
                if (!e.classList.contains('active')){
                    fog.querySelectorAll('.tab').forEach(e => e.classList.remove('active'));
                    e.classList.add('active');
                }
                const content = fog.querySelector(`#content`);
                content.replaceWith(tabsContent[e.id]);
            }
        }));

        fog.addEventListener('click', () => fog.remove());
        fog.querySelector('div').addEventListener('click', e => e.stopPropagation());

        document.body.appendChild(fog);
        fadeIn(fog, 500);

        this.createNewApiContent();
        this.createEditApiContent();
        this.createInfoApiContent();

        const titleInfo = {
            origin: 'Informing an origin restrict the use of your API key to only the designated domain. It is highly recommended for preventing unauthorized calls using your key.',
            note: 'You could set a note to your key for informative purposes.',
        };

        Object.keys(tabsContent).forEach(tab => tabsContent[tab].querySelectorAll('.title i').forEach(e => {
            const inputClass = Array.from(e.parentNode.classList).filter(e => Object.keys(titleInfo).includes(e));
            new Tooltip(e, titleInfo[inputClass]);
        }));

        fog.querySelector('#tab-container #info').click();
    },

    createKey: async function(body) {
        return await (await fetch('/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })).json();
    },

    editKey: async function(key, body) {
        return await (await fetch(`/keys/${key}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })).json();
    },

    getKey: async function(key) {
        return await (await fetch(`/keys/${key}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        })).json();
    },

    updateCredit: async function(key){
        return await (await fetch(`/credit/${key}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
        })).json();
    },

    getCredit: async function(key) {
        return await (await fetch(`/credit/${key}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        })).json();
    },

    copyText: function(parent){
        const input = parent.querySelector('input');
        const oldText = input.value;
        input.value = `COPIED`;
        
        setTimeout(() => input.value = oldText, 500);

        navigator.clipboard.writeText(oldText);
    }
};
document.querySelector('#manage-apikey').addEventListener('click', () => api.showModal());