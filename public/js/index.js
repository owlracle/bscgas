
// change theme dark/light

let theme = 'dark';

document.querySelector('#theme').addEventListener('click' , () => {
    document.body.classList.remove(theme);
    theme = theme == 'dark' ? 'light' : 'dark';
    document.body.classList.add(theme);
});


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
wallet.bindModal(document.querySelector('#donate-link'));


// fade in and out function (work on any element)

function fadeIn(elem, time=300){
    elem.style.transition = `${time/1000}s opacity`;
    elem.style.opacity = '0';

    setTimeout(() => elem.style.opacity = '1', 1);
    setTimeout(() => elem.removeAttribute('style'), time + 100);
}

function fadeOut(elem, time=300){
    elem.style.transition = `${time/1000}s opacity`;

    setTimeout(() => elem.style.opacity = '0', 1);
    setTimeout(() => elem.remove(), time + 100);
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

        this.parent.addEventListener(createEvent, () => {
            this.create();

            if (timeout){
                setTimeout(() => this.kill(), timeout);
            }    
        });

        if (killEvent == 'mouseleave') {
            this.parent.addEventListener(killEvent, () => this.kill());
        }


        return this;
    }

    create() {
        const tooltip = document.createElement('div');
        this.element = tooltip;
        tooltip.classList.add('tooltip');
        tooltip.innerHTML = this.text;

        document.querySelectorAll('.tooltip').forEach(e => e.remove());

        this.parent.insertAdjacentElement('afterend', tooltip);
        fadeIn(tooltip, 200);
    }

    kill() {
        if (this.element){
            fadeOut(this.element, 200);
        }
    }
}


// show tooltips for each gas speed card

const tooltipList = [
    'Around 15 seconds to confirm',
    'Around 15 seconds to confirm',
    'Around 15 seconds to confirm',
    'Confirm almost intantly. But at what cost?',
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
        const data = await (await fetch('/gas')).json();
        const speedList = ['slow', 'standard', 'fast', 'imediate'];
        document.querySelectorAll('.gas .body').forEach((e,i) => {
            if (data[speedList[i]]){
                e.innerHTML = `${data[speedList[i]]} GWei`;
            }
        });
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
    <span class="json key">"imediate"</span>: <span class="json number">${data.imediate || 0}</span>
}`;

    document.querySelector('#sample').innerHTML = formatted;
});
