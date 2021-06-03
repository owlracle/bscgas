const express = require('express');
const request = require('request');
const cors = require('cors');
const mysql = require('mysql2');
const fs = require('fs');

const app = express();
let port = 4200;

// receive args
process.argv.forEach((val, index, array) => {
    if ((val == '-p' || val == '--port') && array[index+1]){
        port = array[index+1];
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
                resp.imediate = data.fastest;
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
                mysqlConnection.execute(`INSERT INTO price_history (imediate, fast, standard, slow) VALUES (?, ?, ?, ?)`, [
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
buildHistory();