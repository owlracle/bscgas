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
            width: 600,
            height: 300,
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
            },
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
        const data = await (await fetch('/gas')).json();
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


// window.post = async function(url, args) {
//     const response = await fetch(url, {
//         method: args.method || 'POST',
//         body: JSON.stringify(args),
//         headers: { 'Content-Type': 'application/json' }
//     });
//     return response.json();
// }