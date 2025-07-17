const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion } = require('mongodb');

// Load env variable from .env file
dotenv.config();

const app = express();
const port = process.env.port || 5000;

// middleware
app.use(cors());
app.use(express.json());





const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@programmingprojects.a8aga1n.mongodb.net/?retryWrites=true&w=majority&appName=ProgrammingProjects`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();




        
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


// sample route
app.get('/', (req, res) => {
    res.send('FitPath Server is running');
});

// start server
app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
});