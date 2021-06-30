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

const USAGE_LIMIT = 1;
const REQUEST_COST = 5;

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
app.post('/keys', async (req, res) => {
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

        const keyCryptPromise = bcrypt.hash(key, 10); 
        const secretCryptPromise = bcrypt.hash(secret, 10);

        const hash = await Promise.all([keyCryptPromise, secretCryptPromise]);

        const data = {
            apiKey: hash[0],
            secret: hash[1],
            wallet: req.body.wallet,
            peek: key.slice(-4),
        };

        if (req.body.origin){
            data.origin = req.body.origin;
        }
        if (req.body.note){
            data.note = req.body.note;
        }

        mysqlConnection.execute(`INSERT INTO api_keys (${Object.keys(data).join(',')}) VALUES (${Object.keys(data).map(() => '?')})`, [
            ...Object.values(data)
        ], (error, rows) => {
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
                    secret: secret
                });
            }
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
        mysqlConnection.execute(`SELECT * FROM api_keys WHERE peek = ?`,[
            key.slice(-4),
        ], async (error, rows) => {
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
                        mysqlConnection.execute(`UPDATE api_keys SET ${fields} WHERE id = ${id}`, (error, rows) => {
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
                        });
                    }
        
                }
            }
        });
    }
});


// get api usage logs
app.get('/logs/:key', cors(corsOptions), async (req, res) => {
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
        mysqlConnection.execute(`SELECT * FROM api_keys WHERE peek = ?`,[ key.slice(-4) ], async (error, rows) => {
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

                    mysqlConnection.execute(`SELECT ip, origin, timestamp FROM api_requests WHERE timestamp > now(3) - INTERVAL 1 HOUR AND apiKey = '${id}' ORDER BY timestamp DESC`, async (error, rows) => {
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
                    });
                }
            }
        });
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
        mysqlConnection.execute(`SELECT * FROM api_keys WHERE peek = ?`,[ key.slice(-4) ], async (error, rows) => {
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
                        hourIp = `SELECT count(*) FROM api_requests WHERE ip = ${ip} AND timestamp >= now() - INTERVAL 1 HOUR`;
                        totalIp = `SELECT count(*) FROM api_requests WHERE ip = ${ip}`;
                    }

                    mysqlConnection.execute(`SELECT (${hourApi}) AS hourapi, (${hourIp}) AS hourip, (${totalApi}) AS totalapi, (${totalIp}) AS totalip`, async (error, rows) => {
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
                    })
                }
            }
        });
    }
});


app.get('/gas', cors(corsOptions), async (req, res) => {
    const key = req.query.apikey;
    const resp = {};
    const sqlData = {};
    const usage = { ip: 0, apiKey: 0 };
    let credit = 0;

    // check how many requests using ip
    if (req.header('x-real-ip')){
        const ip = req.header('x-real-ip');
        mysqlConnection.execute(`SELECT count(*) AS total FROM api_requests WHERE ip = '${ip}' AND timestamp > now() - INTERVAL 1 HOUR`, (error, rows) => {
            if (error){
                resp.error = {
                    status: 500,
                    error: 'Internal Server Error',
                    message: 'Error while trying to discover your api usage.',
                    serverMessage: error,
                };
            }
            else {
                usage.ip = rows[0].total;
            }
        });
    }

    let keyPromise = true;
    if (key){
        keyPromise = new Promise(resolve => {
            mysqlConnection.execute(`SELECT id, apiKey, credit FROM api_keys WHERE peek = '${key.slice(-4)}'`, async (error, rows) => {
                if (error){
                    resp.error = {
                        status: 500,
                        error: 'Internal Server Error',
                        message: 'Error while trying to retrieve api key information from database',
                        serverMessage: error
                    };
                    resolve(true);
                }
                else{
                    const row = (await Promise.all(rows.map(row => bcrypt.compare(key, row.apiKey)))).map((e,i) => e ? rows[i] : false).filter(e => e);

                    if (row.length == 0){
                        resp.error = {
                            status: 401,
                            error: 'Unauthorized',
                            message: 'Could not find your api key.'
                        };
                        resolve(true);
                    }
                    else{
                        sqlData.apiKey = row[0].id;
                        credit = row[0].credit;

                        // discorver usage from api key
                        mysqlConnection.execute(`SELECT count(*) AS total FROM api_requests WHERE apiKey = '${sqlData.apiKey}' AND timestamp > now() - INTERVAL 1 HOUR`, (error, rows) => {
                            if (error){
                                resp.error = {
                                    status: 500,
                                    error: 'Internal Server Error',
                                    message: 'Error while trying to discover your api usage.',
                                    serverMessage: error,
                                };
                            }
                            else {
                                usage.apiKey = rows[0].total;
                            }
                            resolve(true);
                        });
                
                    }
                }
            });
        })
    }

    await keyPromise;

    if (resp.error){
        res.status(resp.error.status);
        res.send(resp.error);
    }
    else if (usage.ip >= USAGE_LIMIT){
        res.status(403);
        res.send({
            status: 403,
            error: 'Forbidden',
            message: 'You have reached the ip address request limit. Try using an api key.'
        });
    }
    else if (key && credit < 0){
        res.status(403);
        res.send({
            status: 403,
            error: 'Forbidden',
            message: 'You dont have enough credits. Recharge or wait a few minutes before trying again.'
        });
    }
    else {
        
        const {error, response, data} = await requestOracle();
    
        if (error){
            res.status(500);
            res.send({
                status: 500,
                error: 'Internal Server Error',
                message: 'Error while trying to fetch information from price oracle.',
                serverMessage: error,
            });
        }
        else {
            if (key && usage.apiKey >= USAGE_LIMIT){
                // reduce credits
                credit -= REQUEST_COST;
                mysqlConnection.execute(`UPDATE api_keys SET credit = '${credit}' WHERE id = ${sqlData.apiKey}`, (error, rows) => {
                    if (error){
                        resp.error = {
                            status: 500,
                            error: 'Internal Server Error',
                            message: 'Error while trying to update credits for api key usage.',
                            serverMessage: error,
                        };
                    }
                });
            }
    
            const oracleData = JSON.parse(data);
            resp.timestamp = new Date().toISOString();
    
            if (oracleData.standard){
                resp.slow = oracleData.safeLow;
                resp.standard = oracleData.standard;
                resp.fast = oracleData.fast;
                resp.instant = oracleData.fastest;
                resp.block_time = oracleData.block_time;
                resp.last_block = oracleData.blockNum;
            }
            else {
                resp.error = 'Oracle is restarting';
            }
    
            sqlData.endpoint = 'gas';
    
            if (req.header('x-real-ip')){
                sqlData.ip = req.header('x-real-ip');
            }
            if (req.header('x-real-ip')){
                sqlData.origin = req.header('Origin');
            }
    
            const fields = Object.keys(sqlData).join(',');
            const values = Object.values(sqlData).map(e => `'${e}'`).join(',');
    
            // save API request to DB for statistics purpose
            mysqlConnection.execute(`INSERT INTO api_requests (${fields}) VALUES (${values})`, (error, rows) => {
                if (error){
                    resp.error = {
                        status: 500,
                        error: 'Internal Server Error',
                        message: 'Error while trying to record api request into the database.',
                        serverMessage: error,
                    };
                }
            });
    
            res.send(resp);
        }
    }
    
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
    mysqlConnection.execute(sql, (error, rows) => {
        // res.send(sql);
        if (error){
            res.status(500);
            res.send({
                status: 500,
                error: 'Internal Server Error',
                message: 'Error while retrieving price history information from database.',
                serverMessage: error,
            });
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
    return new Promise(resolve => resolve({data: JSON.stringify({"safeLow":5.0,"standard":5.0,"fast":5.0,"fastest":5.0,"block_time":15,"blockNum":7499408})}));
    // return new Promise(resolve => {
    //     request('http://127.0.0.1:8097', (error, response, data) => {
    //         // sample data: {"safeLow":5.0,"standard":5.0,"fast":5.0,"fastest":5.0,"block_time":15,"blockNum":7499408}
    //         resolve({ error: error, response: response, data: data });
    //     });
    // });
}

// get prices to build database with price history
async function buildHistory(){
    const oracle = await requestOracle();
    if (oracle.data){
        const data = JSON.parse(oracle.data);

        if (data.standard){
            mysqlConnection.execute(`INSERT INTO price_history (instant, fast, standard, slow) VALUES (?, ?, ?, ?)`, [
                data.fastest,
                data.fast,
                data.standard,
                data.safeLow,
            ], (error, rows) => {
                if (error){
                    console.log(error);
                }
            });
        }
    }

    setTimeout(() => buildHistory(), 1000 * 60); // 1 minute
}

if (saveDB){
    buildHistory();
}