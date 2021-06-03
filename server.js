const express = require('express');
const request = require('request');
const cors = require('cors');
const mysql = require('mysql2');
const fs = require('fs');

const app = express();
const port = 4201;

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
    // request('127.0.0.1:8097').then(resp => resp.json().then(data => {
    request('http://127.0.0.1:8097', (error, response, data) => {
        // sample data: {"safeLow":5.0,"standard":5.0,"fast":5.0,"fastest":5.0,"block_time":15,"blockNum":7499408}
        if (error){
            res.send({ error: error });
        }
        else {
            data = JSON.parse(data);
            const resp = {
                timestamp: new Date().toISOString(),
                slow: data.safeLow,
                standard: data.standard,
                fast: data.fast,
                imediate: data.fastest
            };

            const sql = `INSERT INTO api_requests (ip, origin, response) VALUES ('${req.ip}', '${req.hostname}', '${JSON.stringify(resp)}')`;
            mysqlConnection.query(sql);

            res.send(resp);
        }
    });
});

app.use(express.static(__dirname + '/public/'));

app.listen(port, () => {
    console.log(`Listening to port ${port}`);
});