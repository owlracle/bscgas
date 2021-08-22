const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const mysql = require('mysql2');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const mustacheExpress = require('mustache-express');

const configFile = JSON.parse(fs.readFileSync(`${__dirname}/config.json`));

const app = express();
let port = 4200;

const args = {
    saveDB: true,
    updateCredit: true,
};

const USAGE_LIMIT = 100;
const REQUEST_COST = 10;

app.engine('html', mustacheExpress());
app.set('view engine', 'html');
app.set('views', __dirname + '/views');

// receive args
process.argv.forEach((val, index, array) => {
    if ((val == '-p' || val == '--port') && array[index+1]){
        port = array[index+1];
    }
    if ((val == '-f' || val == '--force-production')){
        configFile.production = true;
    }
    if ((val == '-ns' || val == '--not-save')){
        args.saveDB = false;
    }
    if ((val == '-uc' || val == '--update-credit')){
        args.updateCredit = false;
    }
    if (val == '-t' || val == '--test'){
        configFile.production = false;
        console.log('Production mode OFF');
    }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const corsOptions = {
    origin: '*',
    optionsSuccessStatus: 200,
};


// manage session tokens
class Session {
    static instances = {};
    static timeLimit = 1000 * 60 * 10; // 10 minutes

    static getInstance(sid) {
        return Session.instances[sid] || false;
    }

    constructor() {
        this.sid = uuidv4().split('-').join('');
        Session.instances[this.sid] = this;
        this.refresh();
    }

    getId() {
        return this.sid;
    }

    getExpireAt() {
        return this.expireAt;
    }

    refresh() {
        if (this.timeout){
            clearTimeout(this.timeout);
        }
        this.timeout = setTimeout(() => delete Session.instances[this.sid], Session.timeLimit);
        this.expireAt = new Date().getTime() + Session.timeLimit;
    }

}


app.get('/', (req, res) => {
    res.render(`index`, {
        usagelimit: USAGE_LIMIT,
        requestcost: REQUEST_COST,
        recaptchakey: configFile.recaptcha.key,
    });
});

app.use(express.static(__dirname + '/public/'));

app.listen(port, () => {
    console.log(`Listening to port ${port}`);
});


// --- ROUTES ---


// discover gas prices right now
app.get('/gas', cors(corsOptions), async (req, res) => {
    const dataRun = async () => {
        const resp = {};

        const data = await requestOracle();
        if (data.error){
            return { error: data.error };
        }
    
        resp.timestamp = new Date().toISOString();
    
        if (data.standard){
            resp.slow = data.safeLow;
            resp.standard = data.standard;
            resp.fast = data.fast;
            resp.instant = data.fastest;
            resp.block_time = data.block_time;
            resp.last_block = data.blockNum;
        }

        return resp;
    }

    // request google recaptcha
    if (req.query.grc && req.query.sid) {
        const session = Session.getInstance(req.query.sid);
        if (!session){
            res.status(401);
            res.send({
                status: 401,
                error: 'Unauthorized',
                message: 'Session token invalid.',
            });
            return;
        }
        session.refresh();

        const rc = await verifyRecaptcha(req.query.grc);
        
        if (rc.success && rc.score >= 0.1){
            const data = await dataRun();
            res.send(data);
            return;
        }
        res.status(401);
        res.send({
            status: 401,
            error: 'Unauthorized',
            message: 'Failed to verify recaptcha.',
            serverMessage: rc
        });
        return;
    }

    const resp = await api.automate({
        key: req.query.apikey,
        origin: req.header('Origin'),
        ip: req.header('x-real-ip'),
        endpoint: 'gas',
        action: {
            data: {},
            run: dataRun,
        }
    });
    if (resp.error){
        res.status(resp.error.status || 500);
        res.send(resp.error);
        return;
    }

    res.send(resp);
});


// price history
app.get('/history', cors(corsOptions), async (req, res) => {
    const timeframe = req.query.timeframe;
    const candles = req.query.candles;
    const page = req.query.page;
    const from = req.query.from;
    const to = req.query.to;

    const dataRun = async ({ timeframe, candles, page, from, to }) => {
        const listTimeframes = {
            '10m': 10,
            '30m': 30,
            '1h': 60,
            '2h': 120,
            '4h': 240,
            '1d': 1440,
        };
    
        timeframe = Object.keys(listTimeframes).includes(timeframe) ? listTimeframes[timeframe] : 
            (Object.values(listTimeframes).map(e => e.toString()).includes(timeframe) ? timeframe : 30);
    
        candles = Math.max(Math.min(candles || 1000, 1000), 1);
        const offset = (parseInt(page) - 1) * candles || 0;
        const speeds = ['instant', 'fast', 'standard', 'slow'];
    
        const templateSpeed = speeds.map(speed => `(SELECT p2.${speed} FROM price_history p2 WHERE p2.id = MIN(p.id)) as '${speed}.open', (SELECT p2.${speed} FROM price_history p2 WHERE p2.id = MAX(p.id)) as '${speed}.close', MIN(p.${speed}) as '${speed}.low', MAX(p.${speed}) as '${speed}.high'`).join(',');
        
        const [rows, error] = await db.query(`SELECT MIN(p.timestamp) AS 'timestamp', ${templateSpeed}, count(p.id) AS 'samples' FROM price_history p WHERE UNIX_TIMESTAMP(timestamp) BETWEEN '${from || 0}' AND '${to || new Date().getTime() / 1000}' GROUP BY UNIX_TIMESTAMP(timestamp) DIV ${timeframe * 60} ORDER BY timestamp DESC LIMIT ${candles} OFFSET ${offset}`);
    
        if (error){
            return { error: {
                status: 500,
                error: 'Internal Server Error',
                message: 'Error while retrieving price history information from database.',
                serverMessage: error,
            }};
        }

        const fields = ['open', 'close', 'low', 'high'];

        return rows.map(row => {
            const tempRow = Object.fromEntries(speeds.map(speed => 
                [speed, Object.fromEntries(fields.map(field => 
                    [field, row[`${speed}.${field}`]]
                ))]
            ));
            tempRow.timestamp = row.timestamp;
            tempRow.samples = row.samples;
            return tempRow;
        });
    };

    if (req.query.grc && req.query.sid) {
        const session = Session.getInstance(req.query.sid);
        if (!session){
            res.status(401);
            res.send({
                status: 401,
                error: 'Unauthorized',
                message: 'Session token invalid.',
            });
            return;
        }
        session.refresh();

        const rc = await verifyRecaptcha(req.query.grc);

        if (rc.success && rc.score >= 0.1){
            const data = await dataRun({
                timeframe: timeframe,
                candles: candles,
                page: page,
                from: from,
                to: to,
            });

            res.send(data);
            return;
        }
        res.status(401);
        res.send({
            status: 401,
            error: 'Unauthorized',
            message: 'Failed to verify recaptcha.',
            serverMessage: rc
        });
        return;
    }

    let resp = await api.automate({
        key: req.query.apikey,
        origin: req.header('Origin'),
        ip: req.header('x-real-ip'),
        endpoint: 'history',
        action: {
            data: {
                timeframe: timeframe,
                candles: candles,
                page: page,
                from: from,
                to: to,
            },
            run: dataRun
        }
    });
    if (resp.error){
        res.status(resp.error.status || 500);
        res.send(resp.error);
        return;
    }

    res.send(resp);
});


// generate new api key
app.post('/keys', async (req, res) => {
    if (!req.body.grc) {
        res.status(401);
        res.send({
            status: 401,
            error: 'Unauthorized',
            message: 'Your request did not send all the required fields.',
        });
        return;
    }

    const rc = await verifyRecaptcha(req.body.grc);
    if (!rc.success || rc.score < 0.1){
        res.status(401);
        res.send({
            status: 401,
            error: 'Unauthorized',
            message: 'Failed to verify recaptcha.',
            serverMessage: rc
        });
        return;
    }

    const key = uuidv4().split('-').join('');
    const secret = uuidv4().split('-').join('');

    const keyCryptPromise = bcrypt.hash(key, 10); 
    const secretCryptPromise = bcrypt.hash(secret, 10);

    
    const hash = await Promise.all([keyCryptPromise, secretCryptPromise]);
    
    try {
        // create new wallet for deposits
        const wallet = await (await fetch('https://api.blockcypher.com/v1/eth/main/addrs', { method: 'POST' })).json();
        
        const data = {
            apiKey: hash[0],
            secret: hash[1],
            wallet: `0x${wallet.address}`,
            private: wallet.private,
            peek: key.slice(-4),
        };
    
        if (req.body.origin){
            const origin = api.getOrigin(req.body.origin);
            if (origin){
                data.origin = origin;
            }
        }
        if (req.body.note){
            data.note = req.body.note;
        }

        // get block height now so I know where to start looking for transactions
        data.blockChecked = parseInt(await bscscan.getBlockHeight());

        if (isNaN(data.blockChecked)){
            res.status(500);
            res.send({
                status: 500,
                error: 'Internal Server Error',
                message: 'Error getting network block height',
                serverMessage: data.blockChecked,
            });
        }

        const [rows, error] = await db.insert('api_keys', data);
    
        if (error){
            res.status(500);
            res.send({
                status: 500,
                error: 'Internal Server Error',
                message: 'Error while trying to insert new api key to database',
                serverMessage: error,
            });
        }
        else {
            res.send({
                apiKey: key,
                secret: secret,
                wallet: data.wallet,
            });
        }
    }
    catch (error) {
        res.status(500);
        res.send({
            status: 500,
            error: 'Internal Server Error',
            message: 'Error creating new wallet. Try again in a few minutes.',
            serverMessage: error,
        });
    }
});


// edit api key information
app.put('/keys/:key', async (req, res) => {
    const key = req.params.key;
    const secret = req.body.secret;

    if (!key.match(/^[a-f0-9]{32}$/)){
        res.status(400);
        res.send({
            status: 400,
            error: 'Bad Request',
            message: 'The informed api key is invalid.'
        });
    }
    else if (!secret){
        res.status(400);
        res.send({
            status: 400,
            error: 'Bad Request',
            message: 'The api secret was not provided.'
        });
    }
    else {
        const [rows, error] = await db.query(`SELECT * FROM api_keys WHERE peek = '${key.slice(-4)}'`);

        if (error){
            res.status(500);
            res.send({
                status: 500,
                error: 'Internal Server Error',
                message: 'Error while trying to search the database for your api key.',
                serverMessage: error,
            });
        }
        else{
            const rowsPromise = rows.map(row => Promise.all([
                bcrypt.compare(key, row.apiKey),
                bcrypt.compare(secret, row.secret)
            ]));
            const row = (await Promise.all(rowsPromise)).map((e,i) => e[0] && e[1] ? rows[i] : false).filter(e => e);

            if (row.length == 0){
                res.status(401);
                res.send({
                    status: 401,
                    error: 'Unauthorized',
                    message: 'Could not find an api key matching the provided secret key.'
                });
            }
            else {
                const data = {};
                const id = row[0].id;
    
                let newKey = key;
    
                // fields to edit
                if (req.body.resetKey){
                    newKey = uuidv4().split('-').join('');
                    data.peek = newKey.slice(-4);
                    data.apiKey = await bcrypt.hash(newKey, 10);
                }
                if (req.body.origin){
                    data.origin = req.body.origin;
                }
                if (req.body.note){
                    data.note = req.body.note;
                }
    
                if (Object.keys(data).length == 0){
                    res.send({ message: 'No information was changed.' });
                }
                else {
                    const [rows, error] = await db.update('api_keys', data, `id = ${id}`);
                    
                    if (error){
                        res.status(500);
                        res.send({
                            status: 500,
                            error: 'Internal Server Error',
                            message: 'Error while trying to update api key information.',
                            serverMessage: error,
                        });
                    }
                    else{
                        data.apiKey = newKey;
                        delete data.peek;
        
                        res.send({
                            message: 'api key ionformation updated.',
                            ...data
                        });
                    }
                }
    
            }
        }
    }
});


// get api usage logs
app.get('/logs/:key', cors(corsOptions), async (req, res) => {
    const key = req.params.key;
    const toTime = req.query.totime || 'UNIX_TIMESTAMP(now())';
    const fromTime = req.query.fromtime || `${toTime} - 3600`;

    if (!key.match(/^[a-f0-9]{32}$/)){
        res.status(400);
        res.send({
            status: 400,
            error: 'Bad Request',
            message: 'The informed api key is invalid.'
        });
    }
    else {
        const [rows, error] = await db.query(`SELECT * FROM api_keys WHERE peek = '${key.slice(-4)}'`);

        if (error){
            res.status(500);
            res.send({
                status: 500,
                error: 'Internal Server Error',
                message: 'Error while trying to search the database for your api key.',
                serverMessage: error,
            });
        }
        else{
            const row = (await Promise.all(rows.map(row => bcrypt.compare(key, row.apiKey)))).map((e,i) => e ? rows[i] : false).filter(e => e);
    
            if (row.length == 0){
                res.status(401);
                res.send({
                    status: 401,
                    error: 'Unauthorized',
                    message: 'Could not find your api key.'
                });
            }
            else {
                const id = row[0].id;

                const [rows, error] = await db.query(`SELECT ip, origin, timestamp FROM api_requests WHERE UNIX_TIMESTAMP(timestamp) >= ${fromTime} AND UNIX_TIMESTAMP(timestamp) <= ${toTime} AND apiKey = '${id}' ORDER BY timestamp DESC`);

                if (error){
                    res.status(500);
                    res.send({
                        status: 500,
                        error: 'Internal Server Error',
                        message: 'Error while trying to fetch your logs.',
                        serverMessage: error,
                    });
                }
                else {
                    res.send(rows);
                }
            }
        }
    }

});


// get api key info
app.get('/keys/:key', cors(corsOptions), async (req, res) => {
    const key = req.params.key;

    if (!key.match(/^[a-f0-9]{32}$/)){
        res.status(400);
        res.send({
            status: 400,
            error: 'Bad Request',
            message: 'The informed api key is invalid.'
        });
    }
    else {
        const [rows, error] = await db.query(`SELECT * FROM api_keys WHERE peek = '${key.slice(-4)}'`,);

        if (error){
            res.status(500);
            res.send({
                status: 500,
                error: 'Internal Server Error',
                message: 'Error while trying to search the database for your api key.',
                serverMessage: error,
            });
        }
        else {
            const row = (await Promise.all(rows.map(row => bcrypt.compare(key, row.apiKey)))).map((e,i) => e ? rows[i] : false).filter(e => e);
    
            if (row.length == 0){
                res.status(401);
                res.send({
                    status: 401,
                    error: 'Unauthorized',
                    message: 'Could not find your api key.'
                });
            }
            else {
                const id = row[0].id;
    
                const data = {
                    apiKey: key,
                    creation: row[0].creation,
                    wallet: row[0].wallet,
                    credit: row[0].credit
                };
    
                if (row[0].origin){
                    data.origin = row[0].origin;
                }
                if (row[0].note){
                    data.note = row[0].note;
                }
    
                const hourApi = `SELECT count(*) FROM api_requests WHERE apiKey = ${id} AND timestamp >= now() - INTERVAL 1 HOUR`;
                const totalApi = `SELECT count(*) FROM api_requests WHERE apiKey = ${id}`;
                let hourIp = 'SELECT 0';
                let totalIp = 'SELECT 0';
    
                if (req.header('x-real-ip')){
                    const ip = req.header('x-real-ip');
                    hourIp = `SELECT count(*) FROM api_requests WHERE ip = '${ip}' AND timestamp >= now() - INTERVAL 1 HOUR`;
                    totalIp = `SELECT count(*) FROM api_requests WHERE ip = '${ip}'`;
                }
    
    
                const [rows, error] = await db.query(`SELECT (${hourApi}) AS hourapi, (${hourIp}) AS hourip, (${totalApi}) AS totalapi, (${totalIp}) AS totalip`);

                if (error){
                    res.status(500);
                    res.send({
                        status: 500,
                        error: 'Internal Server Error',
                        message: 'Error while trying to search the database for your api key.',
                        serverMessage: error,
                    });
                }
                else {
                    data.usage = {
                        apiKeyHour: rows[0].hourapi,
                        ipHour: rows[0].hourip,
                        apiKeyTotal: rows[0].totalapi,
                        ipTotal: rows[0].totalip,
                    };
        
                    res.send(data);
                }
            }
        }
    }
});


// request credit info
app.get('/credit/:key', cors(corsOptions), async (req, res) => {
    const key = req.params.key;

    if (!key.match(/^[a-f0-9]{32}$/)){
        res.status(400);
        res.send({
            status: 400,
            error: 'Bad Request',
            message: 'The informed api key is invalid.'
        });
    }
    else {
        const [rows, error] = await db.query(`SELECT * FROM api_keys WHERE peek = '${key.slice(-4)}'`,);

        if (error){
            res.status(500);
            res.send({
                status: 500,
                error: 'Internal Server Error',
                message: 'Error while trying to search the database for your api key.',
                serverMessage: error,
            });
        }
        else {
            const row = (await Promise.all(rows.map(row => bcrypt.compare(key, row.apiKey)))).map((e,i) => e ? rows[i] : false).filter(e => e);
    
            if (row.length == 0){
                res.status(401);
                res.send({
                    status: 401,
                    error: 'Unauthorized',
                    message: 'Could not find your api key.'
                });
            }
            else {
                const [rows, error] = await db.query(`SELECT tx, timestamp, value, fromWallet FROM credit_recharges WHERE apiKey = ${row[0].id} ORDER BY timestamp DESC`);

                if (error){
                    res.status(500);
                    res.send({
                        status: 500,
                        error: 'Internal Server Error',
                        message: 'Error while retrieving your credit information.',
                        serverMessage: error,
                    });
                }
                else {
                    res.send({
                        message: 'success',
                        results: rows
                    });
                }
            }
        }
    }

});


// update credit
app.put('/credit/:key', async (req, res) => {
    const key = req.params.key;

    if (!key.match(/^[a-f0-9]{32}$/)){
        res.status(400);
        res.send({
            status: 400,
            error: 'Bad Request',
            message: 'The informed api key is invalid.'
        });
    }
    else {
        const [rows, error] = await db.query(`SELECT * FROM api_keys WHERE peek = '${key.slice(-4)}'`,);

        if (error){
            res.status(500);
            res.send({
                status: 500,
                error: 'Internal Server Error',
                message: 'Error while trying to search the database for your api key.',
                serverMessage: error,
            });
        }
        else {
            const row = (await Promise.all(rows.map(row => bcrypt.compare(key, row.apiKey)))).map((e,i) => e ? rows[i] : false).filter(e => e);
    
            if (row.length == 0){
                res.status(401);
                res.send({
                    status: 401,
                    error: 'Unauthorized',
                    message: 'Could not find your api key.'
                });
            }
            else {
                const id = row[0].id;
                const wallet = row[0].wallet;
                const block = row[0].blockChecked + 1;

                const data = {};
                data.api_keys = { credit: row[0].credit };
                data.api_keys.blockChecked = await bscscan.getBlockHeight();
                
                const txs = await bscscan.getTx(wallet, block, data.api_keys.blockChecked);

                data.credit_recharges = {
                    tx: [],
                    value: [],
                    timestamp: [],
                    fromWallet: [],
                    apiKey: [],
                };
                
                if (txs.status == "1"){
                    txs.result.forEach(tx => {
                        if (tx.isError == "0" && tx.to.toLowerCase() == wallet.toLowerCase()){
                            // 33122453711370938 == 0.03312245371137 BNB
                            // const value = 50000000000;
                            const value = parseInt(tx.value.slice(0,-10));
                            data.api_keys.credit = parseInt(data.api_keys.credit) + value;

                            data.credit_recharges.tx.push(tx.hash);
                            data.credit_recharges.value.push(value);
                            data.credit_recharges.timestamp.push(parseInt(tx.timeStamp));
                            data.credit_recharges.fromWallet.push(tx.from);
                            data.credit_recharges.apiKey.push(id);
                        }
                    })
                }
                
                db.update('api_keys', data.api_keys, `id = ${id}`);
                db.insert('credit_recharges', data.credit_recharges, { timestamp: `UNIX_TIMESTAMP({{}})` });

                res.send(txs);
            }
        }
    }
});


app.post('/session', async (req, res) => {
    if (!req.body.grc) {
        res.status(401);
        res.send({
            status: 401,
            error: 'Unauthorized',
            message: 'Your request did not send all the required fields.',
        });
        return;
    }

    const rc = await verifyRecaptcha(req.body.grc);
    if (!rc.success || rc.score < 0.1){
        res.status(401);
        res.send({
            status: 401,
            error: 'Unauthorized',
            message: 'Failed to verify recaptcha.',
            serverMessage: rc
        });
        return;
    }

    const session = (() => {
        if (req.body.currentSession){
            const session = Session.getInstance(req.body.currentSession);
            return session || new Session();
        }
        return new Session();
    })();

    res.send({
        message: 'success',
        sessionid: session.getId(),
        expireAt: session.getExpireAt(),
    });
});


// --- helper functions and objects ---

const db = {
    working: false,

    query: async function(sql) {
        return new Promise(resolve => this.connection.execute(sql, (error, rows) => {
            if (error && error.fatal){
                if (this.connection){
                    this.connection.destroy();
                }
                // const content = [
                //     'Disconnected',
                //     new Date().toISOString(),
                //     JSON.stringify(error),
                // ];
                // fs.appendFile(`mysqlConnectionLog.csv`,  content.join(',') + '\n', () => {});
                
                if (this.working){
                    telegram.alert('Bscgas down!');
                }
                
                this.working = false;

                this.connect();
                setTimeout(async () => resolve(await this.query(sql)), 1000);
            }
            else{
                resolve([rows, error])
            }
        }));
    },

    // {field_1: 0, field_2: 'a'}
    // or
    // {field_1: [0,1,2], field_2: ['a', 'b', 'c']}
    // format is required if you want a field to be inserted in a format different than string.
    //     you should inform an object:
    //     { field_1: `prefix{{}}suffix` }
    //     use {{}} to inform where the value will be inserted
    insert: async function(table, obj, format){
        let fields = Object.keys(obj);
        const values = Object.values(obj).map(e => Array.isArray(e) ? e : [e]);

        let valuesRow = [];
        for (let f in values){
            for (let e in values[f]){
                if (valuesRow.length == e){
                    valuesRow.push([]);
                }
                if (valuesRow[e].length == f){
                    valuesRow[e].push([]);
                }

                let value = `'${values[f][e]}'`;
                if (format && Object.keys(format).includes(fields[f])){
                    const formatString = format[fields[f]].split('{{}}');
                    value = [ formatString[0], values[f][e], formatString[1] ].join('');
                }

                valuesRow[e][f] = value;
            }
        }

        fields = fields.join(',');
        valuesRow = valuesRow.map(r => `(${ r.join(',') })`).join(',');
        const sql = `INSERT INTO ${table} (${fields}) VALUES ${valuesRow}`;

        return this.query(sql);
    },

    // obj: {field_1: 0, field_2: 'a'}
    // filter: sql text after WHERE
    update: async function(table, obj, filter){
        const changesSql = Object.entries(obj).map(e => `${e[0]} = '${e[1]}'`).join(',');
        const sql = `UPDATE ${table} SET ${changesSql} WHERE ${filter}`;
        return this.query(sql);
    },

    connect: function(){
        if (!this.working){
            this.connection = mysql.createConnection(configFile.mysql);
    
            this.connection.connect( opt => {
                // const content = [
                //     'Connected',
                //     new Date().toISOString(),
                //     JSON.stringify(opt),
                // ];
                // fs.appendFile(`mysqlConnectionLog.csv`,  content.join(',') + '\n', () => {});
    
                if (!opt){
                    if (!this.working){
                        telegram.alert('Bscgas Up!');
                    }
    
                    this.working = true;
                }
            });
        }
    },
};
db.connect();


async function requestOracle(){
    try{
        if (configFile.production){
            return (await fetch('http://127.0.0.1:8097')).json();
        }
        return new Promise(resolve => resolve({"safeLow":5.0,"standard":5.0,"fast":5.0,"fastest":5.0,"block_time":15,"blockNum":7499408}));    
    }
    catch (error){
        return { error: {
            status: 500,
            error: 'Internal Server Error',
            message: 'Error while trying to fetch information from price oracle.',
            serverMessage: error,
        }};
    }
}


// get prices to build database with price history
async function buildHistory(){
    try{
        const data = await requestOracle();

        if (data.standard){
            const [rows, error] = await db.insert(`price_history`, {
                instant: data.fastest,
                fast: data.fast,
                standard: data.standard,
                slow: data.safeLow,
            });
            
            if (error){
                console.log(error);
            }
        }
    }
    catch (error) {
        console.log(error);
    }
    finally {
        setTimeout(() => buildHistory(), 1000 * 60); // 1 minute
    }
}


// update credit recharges and block height for all api keys
async function updateAllCredit(){
    const [rows, error] = await db.query(`SELECT * FROM api_keys`);
    if (!error){
        const blockHeight = await bscscan.getBlockHeight();
        rows.forEach(async row => {
            const id = row.id;
            const wallet = row.wallet;
            const block = row.blockChecked + 1;
    
            const data = {};
            data.api_keys = { credit: row.credit };
            data.api_keys.blockChecked = blockHeight;
            
            const txs = await bscscan.getTx(wallet, block, data.api_keys.blockChecked);
    
            data.credit_recharges = {
                tx: [],
                value: [],
                timestamp: [],
                fromWallet: [],
                apiKey: [],
            };
            
            if (txs.status == "1"){
                txs.result.forEach(tx => {
                    if (tx.isError == "0" && tx.to.toLowerCase() == wallet.toLowerCase()){
                        const value = parseInt(tx.value.slice(0,-10));
                        data.api_keys.credit = parseInt(data.api_keys.credit) + value;
    
                        data.credit_recharges.tx.push(tx.hash);
                        data.credit_recharges.value.push(value);
                        data.credit_recharges.timestamp.push(parseInt(tx.timeStamp));
                        data.credit_recharges.fromWallet.push(tx.from);
                        data.credit_recharges.apiKey.push(id);
                    }
                })
            }
            
            db.update('api_keys', data.api_keys, `id = ${id}`);
            db.insert('credit_recharges', data.credit_recharges, { timestamp: `UNIX_TIMESTAMP({{}})` });
        });
    }

    setTimeout(() => updateAllCredit(), 1000 * 60 * 60); // 1 hour
}


if (configFile.production){
    if (args.saveDB){
        buildHistory();
    }
    if (args.updateCredit){
        updateAllCredit();
    }
}


const bscscan = {
    apiKey: configFile.bscscan,

    getBlockHeight: async function() {
        const timeNow = (new Date().getTime() / 1000).toFixed(0);
        let block = await (await fetch(`https://api.bscscan.com/api?module=block&action=getblocknobytime&timestamp=${timeNow}&closest=before&apikey=${this.apiKey}`)).json();
        return block.result;
    },

    getTx: async function(wallet, from, to){
        return await (await fetch(`https://api.bscscan.com/api?module=account&action=txlist&address=${wallet}&startblock=${from}&endblock=${to}&apikey=${this.apiKey}`)).json();
    }
};


const api = {
    getUsage: async function(keyId, ip) {
        const usage = { ip: 0, apiKey: 0 };

        if (ip) {
            // get usage from ip
            const [rows, error] = await db.query(`SELECT count(*) AS total FROM api_requests WHERE ip = '${ip}' AND timestamp > now() - INTERVAL 1 HOUR`);
    
            if (error){
                return { error: {
                    status: 500,
                    error: 'Internal Server Error',
                    message: 'Error while trying to discover your api usage.',
                    serverMessage: error,
                }};
            }

            usage.ip = rows[0].total;
        }

        if (keyId) {
            // sent key hash instead of id
            if (typeof keyId === 'string' && keyId.length == 32){
                const keyInfo = await this.getKeyInfo(keyId);
                if (keyInfo.result){
                    keyId = keyInfo.result.id;
                }
                else {
                    return { error: keyInfo.error };
                }
            }

            // discorver usage from api key
            const [rows, error] = await db.query(`SELECT count(*) AS total FROM api_requests WHERE apiKey = '${keyId}' AND timestamp > now() - INTERVAL 1 HOUR`);
    
            if (error){
                return { error: {
                    status: 500,
                    error: 'Internal Server Error',
                    message: 'Error while trying to discover your api usage.',
                    serverMessage: error,
                }};
            }

            usage.apiKey = rows[0].total;
        }

        return usage;
    },

    getKeyInfo: async function(key){
        const [rows, error] = await db.query(`SELECT id, apiKey, credit, origin FROM api_keys WHERE peek = '${key.slice(-4)}'`);

        if (error){
            return { error: {
                status: 500,
                error: 'Internal Server Error',
                message: 'Error while trying to retrieve api key information from database',
                serverMessage: error
            }};
        }

        const row = (await Promise.all(rows.map(row => bcrypt.compare(key, row.apiKey)))).map((e,i) => e ? rows[i] : false).filter(e => e);

        if (row.length == 0){
            return { error: {
                status: 401,
                error: 'Unauthorized',
                message: 'Could not find your api key.'
            }};
        }

        return { result: row[0] };
    },

    getOrigin: function(origin){
        const originRegex = new RegExp(/^(?:https?:\/\/)?(?:www\.)?([a-z0-9._-]{1,256}\.[a-z0-9]{1,6})\b.*$/);
        const match = origin.match(originRegex);
        return match && match[1] ? match[1] : false;
    },

    validateOrigin: async function(keyOrigin, reqOrigin){
        let originAllow = true;
        if (keyOrigin){
            if (reqOrigin){
                const realOrigin = this.getOrigin(reqOrigin);
                if (keyOrigin != realOrigin){
                    originAllow = false;
                }
            }
            else{
                originAllow = false;
            }
        }

        if (!originAllow){
            return { error: {
                status: 403,
                error: 'Forbidden',
                message: 'The API key your are using does not allow calls from this origin.',
            }};
        }

        return true;
    },

    authorizeKey: function(key, ip, usage, credit){
        // TODO: block !key requests in the future
        if (!key && usage.ip >= USAGE_LIMIT){
            return { error: {
                status: 403,
                error: 'Forbidden',
                message: 'You have reached the ip address request limit. Try using an API key.'
            }};
        }
        else if (key && credit < 0 && (usage.apiKey >= USAGE_LIMIT || usage.ip >= USAGE_LIMIT)){
            return { error: {
                status: 403,
                error: 'Forbidden',
                message: 'You dont have enough credits. Recharge or wait a few minutes before trying again.'
            }};
        }

        return true;
    },

    reduceCredit: async function(keyId, usage, credit) {
        if (keyId && (usage.apiKey >= USAGE_LIMIT || usage.ip >= USAGE_LIMIT)){
            // reduce credits
            credit -= REQUEST_COST;
            const [rows, error] = await db.update('api_keys', {credit: credit}, `id = ${keyId}`);
    
            if (error){
                return { error: {
                    status: 500,
                    error: 'Internal Server Error',
                    message: 'Error while trying to update credits for api key usage.',
                    serverMessage: error,
                }};
            }
        }

        return true;    
    },

    automate: async function({ key, origin, ip, endpoint, action }) {
        let resp = {};
        const sqlData = {};
        let credit = 0;
    
        if (key){
            const keyRow = await this.getKeyInfo(key);
            if (keyRow.error){
                return { error: keyRow.error };
            }

            resp = this.validateOrigin(keyRow.origin, origin);
            if (resp.error) {
                return { error: resp.error };
            }
    
            sqlData.apiKey = keyRow.result.id;
            credit = keyRow.result.credit;
        }
    
        const usage = await this.getUsage(sqlData.apiKey, ip);
        if (usage.error){
            return { error: usage.error };
        }
    
        resp = this.authorizeKey(key, ip, usage, credit);
        if (resp.error){
            return { error: resp.error };
        }

        const actionResp = action.run(action.data);
        if (actionResp.error){
            return { error: actionResp.error };
        }

        resp = await this.reduceCredit(sqlData.apiKey, usage, credit);
        if (resp.error){
            return { error: resp.error };
        }

        sqlData.endpoint = endpoint;

        if (ip){
            sqlData.ip = ip;
        }
        if (origin){
            sqlData.origin = origin;
        }
    
        resp = await this.recordRequest(sqlData);
        if (resp.error){
            return { error: resp.error };
        }

        return actionResp;
    },

    recordRequest: async function(data) {
        // save API request to DB for statistics purpose
        const [rows, error] = await db.insert('api_requests', data);
        if (error){
            return { error: {
                status: 500,
                error: 'Internal Server Error',
                message: 'Error while trying to record api request into the database.',
                serverMessage: error,
            }};
        }

        return rows;
    },
}

async function verifyRecaptcha(token){
    const secret = configFile.recaptcha.secret;

    try {
        const data = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method: 'POST',
            body: `secret=${secret}&response=${token}`,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        return await data.json();
    }
    catch(error){
        console.log(error);
        return error;
    }
}

const telegram = {
    url: `https://api.telegram.org/bot{{token}}/sendMessage?chat_id={{chatId}}&text=`,

    alert: async function(message){
        if (!this.token){
            this.token = configFile.telegram.token;
            this.chatId = configFile.telegram.chatId;

            this.url = this.url.replace(`{{token}}`, this.token).replace(`{{chatId}}`, this.chatId);
        }
        if (typeof message !== 'string'){
            message = JSON.stringify(message);
        }

        const resp = configFile.production ? await (await fetch(this.url + encodeURIComponent(message))).json() : true;
        return resp;
    }
}