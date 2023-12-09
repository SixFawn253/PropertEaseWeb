const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sqlite = require('sqlite3').verbose();
const crypto = require('crypto');
const app = express();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const fs = require('fs');
const { parseHousePlan } = require('../tool/common.js');

function getNextHouseId(database, callback) {
    database.get('select max(id) as id from House', (error, row) => {
        if (error) {
            console.error(error);
            return;
        }
        if (row.id === null) {
            callback(1);
            return;
        }
        callback(row.id + 1);
    });
}

function makeSha512Hash(string) {
    const hash = crypto.createHash('sha512');
    const data = hash.update(String(string), 'utf-8');
    return data.digest('hex');
}

function handleRequest(request, result, info) {
    console.log("request received: \"", request ,"\",");
    if (info.query) {
        database.all(info.query, info.parameters(request), (error, rows) => {
            if (error) {
                info?.error(request, result, error);
                console.error(error);
                return;
            }
            console.log("sent: \"", rows ,"\",,");
            info.callback(result, rows);
        });
    } else {
        info.callback(request, result);
    }
}

function registerGetApiEndpoint(app, database, info) {
    app.get(info.endpoint, (request, result) => {
        handleRequest(request, result, info);
    });
}

function registerPostApiEndpoint(app, database, info) {
    app.post(info.endpoint, (request, result) => {
        handleRequest(request, result, info);
    });
}

const database = new sqlite.Database('../main.sqlite', (error) => {
    if (error) {
        console.error(error.message);
    }
    console.log('connected to the main database.');
});
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

registerGetApiEndpoint(app, database, {
    endpoint: '/api/data/houses',
    query: 'select * from House',
    parameters: _ => [],
    callback: (result, rows) => {
        result.send(rows);
    }
});
registerGetApiEndpoint(app, database, {
    endpoint: '/api/data/types',
    query: 'select * from Type',
    parameters: _ => [],
    callback: (result, rows) => {
        result.send(rows);
    }
});
registerGetApiEndpoint(app, database, {
    endpoint: '/api/data/houses/id/:houseId',
    query: 'select * from House where id = ?',
    parameters: (request) => [request.params.houseId],
    callback: (result, rows) => {
        if (rows.length > 0) {
            result.send(rows);
        } else {
            result.status(404).send({});
        }
    }
});

registerPostApiEndpoint(app, database, {
    endpoint: '/api/login/signin',
    query: `select username, permissions from User where username = ? and password = ?`,
    parameters: (request) => {
        const username = request.body.username;
        const password = makeSha512Hash(request.body.password);
        return [username, password];
    },
    callback: (result, rows) => {
        if (rows.length > 0) {
            result.send({
                user: rows[0],
            });
        } else {
            result.status(401).send({
                user: null,
            });
        }
    }
});

registerPostApiEndpoint(app, database, {
    endpoint: '/api/login/signup',
    query: `insert into User values (?, ?, 0)`,
    parameters: (request) => {
        const username = request.body.username;
        const password = makeSha512Hash(request.body.password);
        return [username, password];
    },
    callback: (result, rows) => {

    },
    error: (request, result, error) => {
        if (error.code === 'SQLITE_CONSTRAINT') {
            result.status(401).send({
                code: 'PEB_ERROR_USERNAME_TAKEN',
            });
        }
    }
});

app.post('/api/data/tool/upload', upload.array('files'), (request, result) => {
    const files = request.files;
    const plan = decodeURI(request.body.plan);
    const parsedPlan = parseHousePlan(plan.split('\n'));
    const info = JSON.parse(decodeURI(request.body.info));
    getNextHouseId(database, (id) => {
        const baseUploadsPath = `uploads`;
        const baseImagePath = `images/${id}`;
        fs.mkdir(`../${baseImagePath}`, (_) => {
            const imageIds = new Map();
            for (const [index, image] of files.entries()) {
                const previous = `${baseUploadsPath}/${image.filename}`;
                const current = `${baseImagePath}/${image.originalname}`;
                fs.renameSync(previous, `../${current}`);
                imageIds.set(parsedPlan.images[index], current);
            }

            const parameters = [
                info['address'],
                info['city'],
                info['zip'],
                info['description'],
                info['contract'],
                info['price'],
                info['floor'],
                // !! means convert to boolean
                !!info['elevator'],
                info['balconies'],
                info['terrace'],
                info['garden'],
                info['accessories'],
                info['bedrooms'],
                info['energy_class'],
                info['energy_performance'],
                info['energy_system'],
                info['fuel'],
                plan,
                JSON.stringify(Array.from(imageIds.entries()).map(([k, v]) => { return { [k]: v }; })),
                info['house']
            ];
            const fields = `
                address,
                city,
                cap,
                description,
                contract,
                price,
                floor,
                elevator,
                balconies,
                terrace,
                garden,
                accessories,
                bedrooms,
                energy_class,
                energy_perf,
                energy_system,
                energy_fuel,
                plan,
                images,
                e_type
            `;
            database.run(`insert into House (${fields}) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, parameters, (error) => {
                if (error) {
                    console.error(error);
                    return;
                }
                result.send({});
            });
        });
    });
});

const port = 8080;
app.listen(port, () => {
    console.log(`listening on port ${port}.`);
});
