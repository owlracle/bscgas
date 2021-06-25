const express = require('express');
const request = require('request');
const cors = require('cors');
const mysql = require('mysql2');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');


const app = express();
let port = 4200;
let saveDB = true;

// receive args
process.argv.forEach((val, index, array) => {
    if ((val == '-p' || val == '--port') && array[index+1]){
        port = array[index+1];
    }
    if ((val == '-ns' || val == '--not-save')){
        saveDB = false;
    }
});

const mysqlConnection = mysql.createConnection(JSON.parse(fs.readFileSync(__dirname  + '/mysql_config.json')));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(`public/html/index.html`, { root: __dirname });
});

const corsOptions = {
    origin: '*',
    optionsSuccessStatus: 200,
};


// generate new api key
app.post('/keys', (req, res) => {
    if (!req.body.user){
        res.status(400);
        res.send({
            status: 400,
            error: 'Bad Request',
            message: 'User is not provided.'
        });
    }
    if (!req.body.wallet){
        res.status(400);
        res.send({
            status: 400,
            error: 'Bad Request',
            message: 'Wallet is missing.'
        });
    }
    else if (!req.body.wallet.match(/^0x[a-fA-F0-9]{40}$/)){
        res.status(400);
        res.send({
            status: 400,
            error: 'Bad Request',
            message: 'The informed wallet is invalid.'
        });
    }
    else {
        const key = uuidv4().split('-').join('');
        const secret = uuidv4().split('-').join('');
        const user = req.body.user.trim().slice(0,128);

        const keyCryptPromise = bcrypt.hash(key, 10); 
        const secretCryptPromise = bcrypt.hash(secret, 10);

        Promise.all([keyCryptPromise, secretCryptPromise]).then(hash => {
            const data = {
                user: user,
                apiKey: hash[0],
                secret: hash[1],
                wallet: req.body.wallet
            };
    
            if (req.body.origin){
                data.origin = req.body.origin;
            }
            if (req.body.note){
                data.note = req.body.note;
            }

            mysqlConnection.execute(`INSERT INTO api_keys (${Object.keys(data).join(',')}) VALUES (${Object.keys(data).map(() => '?')})`, [
                ...Object.values(data)
            ]);
    
            res.send({
                user: user,
                apiKey: key,
                secret: secret
            });
        })

    }

    // should print api key. generate one if not exists
    // timestamp of creation
    // total requests
    // requests last hour
    // bnb credit left

    // generate password
    // bcrypt.hash('pass', 10, function(err, hash) {
    // });
    // bcrypt.compare('pass', hash, function(err, result) {
    // });
});


// edit api key information
app.put('/keys/:key', (req, res) => {
    const key = req.params.key;
    const user = req.body.user;
    const secret = req.body.secret;

    if (!key.match(/^[a-f0-9]{32}$/)){
        res.status(400);
        res.send({
            status: 400,
            error: 'Bad Request',
            message: 'The informed api key is invalid.'
        });
    }
    else if (!user){
        res.status(400);
        res.send({
            status: 400,
            error: 'Bad Request',
            message: 'User name is not provided.'
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
        mysqlConnection.execute(`SELECT * FROM api_keys WHERE user = ?`,[ user ], async (err, rows) => {
            const rowsPromise = await Promise.all(rows.map(e => Promise.all([
                bcrypt.compare(key, e.apiKey),
                bcrypt.compare(secret, e.secret)
            ])));

            const row = rowsPromise.map((e,i) => e.filter(e => e).length == 2 ? rows[i] : false).filter(e => e);

            if (row.length == 0){
                res.status(401);
                res.send({
                    status: 401,
                    error: 'Unauthorized',
                    message: 'Could not find an api key and secret matching your user name.'
                });
            }
            else {
                const data = {};
                const id = row[0].id;

                let newKey = data.apiKey;

                // fields to edit
                if (req.body.resetKey){
                    newKey = uuidv4().split('-').join('');
                    data.apiKey = await bcrypt.hash(newKey, 10);
                }
                if (req.body.wallet && req.body.wallet.match(/^0x[a-fA-F0-9]{40}$/)){
                    data.wallet = req.body.wallet;
                }
                if (req.body.origin){
                    data.origin = req.body.origin;
                }
                if (req.body.note){
                    data.note = req.body.note;
                }

                const fields = Object.entries(data).map(e => `${e[0]} = '${e[1]}'`).join(',');

                if (fields == ''){
                    res.send({ message: 'No information was changed.' });
                }
                else {
                    const sql = `UPDATE api_keys SET ${fields} WHERE id = ${id}`;
                    mysqlConnection.execute(sql, (error, result) => {
                        if (error){
                            res.status(500);
                            res.send(error);
                        }
                        else{
                            data.apiKey = newKey;
            
                            res.send({
                                message: 'api key ionformation updated.',
                                ...data
                            });
                        }
                    });
                }

            }
        });
    }});


// get api key info
app.get('/keys/:key', cors(corsOptions), (req, res) => {
    const key = req.params.key;
    const user = req.query.user;

    if (!key.match(/^[a-f0-9]{32}$/)){
        res.status(400);
        res.send({
            status: 400,
            error: 'Bad Request',
            message: 'The informed api key is invalid.'
        });
    }
    else if (!user){
        res.status(400);
        res.send({
            status: 400,
            error: 'Bad Request',
            message: 'User name is not provided.'
        });
    }
    else {
        mysqlConnection.execute(`SELECT * FROM api_keys WHERE user = ?`,[ user ], (err, rows) => {
            Promise.all(rows.map(e => bcrypt.compare(key, e.apiKey))).then(matches => {
                const row = matches.map((e,i) => e ? rows[i] : false).filter(e => e);

                if (row.length == 0){
                    res.status(401);
                    res.send({
                        status: 401,
                        error: 'Unauthorized',
                        message: 'Could not find an api key matching your user name.'
                    });
                }
                else {
                    const data = {
                        user: row[0].user,
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

                    res.send(data);
                }

            });

        });
    }
});


app.get('/gas', cors(corsOptions), (req, res) => {
    requestOracle().then(({error, response, data}) => {
        if (error){
            res.send({ error: error });
        }
        else {
            data = JSON.parse(data);
            const resp = {};
            resp.timestamp = new Date().toISOString();

            if (data.standard){
                resp.slow = data.safeLow;
                resp.standard = data.standard;
                resp.fast = data.fast;
                resp.instant = data.fastest;
                resp.block_time = data.block_time;
                resp.last_block = data.blockNum;
            }
            else {
                resp.error = 'Oracle is restarting';
            }

            // save API request to DB for statistics purpose
            try {
                mysqlConnection.execute(`INSERT INTO api_requests (ip, origin) VALUES (?, ?)`, [
                    `${req.header('x-real-ip') || ''}`,
                    `${req.header('Origin') || ''}`,
                ]);
            }
            catch(err) {
                console.log(err);
            }

            res.send(resp);
        }
    });
});

app.get('/history', cors(corsOptions), async (req, res) => {
    const listTimeframes = {
        '10m': 10,
        '30m': 30,
        '1h': 60,
        '2h': 120,
        '4h': 240,
        '1d': 1440,
    };

    const timeframe = Object.keys(listTimeframes).includes(req.query.timeframe) ? listTimeframes[req.query.timeframe] : 
        (Object.values(listTimeframes).map(e => e.toString()).includes(req.query.timeframe) ? req.query.timeframe : 30);

    const candles = Math.max(Math.min(req.query.candles || 1000, 1000), 1);
    const offset = (parseInt(req.query.page) - 1) * candles || 0;
    const speeds = ['instant', 'fast', 'standard', 'slow'];

    const templateSpeed = speeds.map(speed => `(SELECT p2.${speed} FROM price_history p2 WHERE p2.id = MIN(p.id)) as '${speed}.open', (SELECT p2.${speed} FROM price_history p2 WHERE p2.id = MAX(p.id)) as '${speed}.close', MIN(p.${speed}) as '${speed}.low', MAX(p.${speed}) as '${speed}.high'`).join(',');
    
    const sql = mysqlConnection.format(`SELECT p.timestamp, ${templateSpeed}, count(p.id) AS 'samples' FROM price_history p WHERE UNIX_TIMESTAMP(p.timestamp) BETWEEN ? AND ? GROUP BY UNIX_TIMESTAMP(p.timestamp) DIV ? ORDER BY p.timestamp DESC LIMIT ? OFFSET ?`, [
        req.query.from || 0,
        req.query.to || new Date().getTime() / 1000,
        timeframe * 60,
        candles,
        offset,
    ]);
    mysqlConnection.execute(sql, (err, rows) => {
        // res.send(sql);
        if (err){
            res.send({error: err});
            // res.send({error: err, sql: sql});
        }
        else {
            const fields = ['open', 'close', 'low', 'high'];

            rows = rows.map(row => {
                const tempRow = Object.fromEntries(speeds.map(speed => 
                    [speed, Object.fromEntries(fields.map(field => 
                        [field, row[`${speed}.${field}`]]
                    ))]
                ));
                tempRow.timestamp = row.timestamp;
                tempRow.samples = row.samples;
                return tempRow;
            });

            res.send(rows);
        }
    });
});

app.use(express.static(__dirname + '/public/'));

app.listen(port, () => {
    console.log(`Listening to port ${port}`);
});

async function requestOracle(){
    return new Promise(resolve => {
        request('http://127.0.0.1:8097', (error, response, data) => {
            // sample data: {"safeLow":5.0,"standard":5.0,"fast":5.0,"fastest":5.0,"block_time":15,"blockNum":7499408}
            resolve({ error: error, response: response, data: data });
        });
    });
}

// get prices to build database with price history
async function buildHistory(){
    const oracle = await requestOracle();
    if (oracle.data){
        const data = JSON.parse(oracle.data);

        if (data.standard){
            try {
                mysqlConnection.execute(`INSERT INTO price_history (instant, fast, standard, slow) VALUES (?, ?, ?, ?)`, [
                    data.fastest,
                    data.fast,
                    data.standard,
                    data.safeLow,
                ]);
            }
            catch(err) {
                console.log(err);
            }
        }
    }

    setTimeout(() => buildHistory(), 1000 * 60); // 1 minute
}

if (saveDB){
    buildHistory();
}