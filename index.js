const dotenv = require('dotenv');
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");

// Load env variable from .env file
dotenv.config();

const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);



const app = express();
const port = process.env.port || 3000;

// middleware
app.use(cors());
app.use(express.json());




var serviceAccount = require("./firebase-admin-key.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount)
// });




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

        const db = client.db("fitPathDB");
        const usersCollection = db.collection("users");
        const classesCollection = db.collection("classes");
        const slotsCollection = db.collection("slots");
        const appliedTrainersCollection = db.collection("appliedTrainers");
        const rejectedTrainersCollection = db.collection("rejectedTrainers");
        const paymentsCollection = db.collection("payments");
        const reviewsCollection = db.collection("reviews");
        const newsletterCollection = db.collection("newsletter");
        const forumsCollection = db.collection("forums");


        // Verify Firebase Token Middleware

        const verifyFBToken = async (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader) return res.status(401).send({ message: 'Unauthorized access' });

            const token = authHeader.split(' ')[1];
            if (!token) {
                return res.status(401).send({ message: 'Unauthorized access' });
            }
            //   verify the token
            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
                console.log('Decoded User:', req.decoded);
                next();
            } catch (error) {
                console.error('Error verifying token:', error);
                res.status(403).send({ error: 'Forbidden access' });
            }
        };

        const verifyAdmin = async (req, res, next) => {
            if (!req.decoded || !req.decoded.email) {
                return res.status(403).send({ message: 'Email not found in token' });
            }
            const email = req.decoded.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }

        const verifyTrainer = async (req, res, next) => {
            if (!req.decoded || !req.decoded.email) {
                return res.status(403).send({ message: 'Email not found in token' });
            }
            const email = req.decoded.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            if (!user || user.role !== 'trainer') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }

        // ✅ Get role of a user
        app.get('/users/role/:email', async (req, res) => {
            const { email } = req.params;
            try {
                const user = await usersCollection.findOne({ email });
                if (!user) {
                    return res.status(404).json({ role: null });
                }
                res.json({ role: user.role || 'member' }); 
            } catch (e) {
                res.status(500).json({ role: null });
            }
        });


        // ✅ Demote trainer to member
        app.patch('/trainers/demote/:email', async (req, res) => {
            const { email } = req.params;
            try {
                const result = await usersCollection.updateOne(
                    { email: email, role: 'trainer' }, 
                    { $set: { role: 'user' } }
                );
                if (result.modifiedCount > 0) {
                    res.send({ success: true });
                } else {
                    res.status(404).send({ success: false, message: 'Not found or already a member' });
                }
            } catch (error) {
                console.error("Error in demotion:", error);
                res.status(500).send({ success: false, message: 'Internal Server Error' });
            }
        });

        // Get all trainers
        app.get('/trainers', async (req, res) => {
            try {
                const trainers = await usersCollection.find({ role: 'trainer' }).toArray();
                res.json(trainers);  
            } catch (error) {
                console.error("Error fetching trainers:", error);
                res.status(500).json({ error: "Failed to fetch trainers. Please try again later." });
            }
        });


        // Add this to your server file where other routes are declared
        app.get('/chart-stats', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const totalPayments = await paymentsCollection.find({}).toArray();

                const totalBalance = totalPayments.reduce((sum, p) => sum + (p.price || 0), 0);

                const lastSix = totalPayments
                    .filter(p => p.date)
                    .sort((a, b) => new Date(b.date) - new Date(a.date))
                    .slice(0, 6)
                    .map(p => ({
                        amount: p.price || 0,
                        memberName: p.userName || "Unknown",
                        date: p.date || new Date()
                    }));

                const newsletterCount = await newsletterCollection.countDocuments();
                const paidMembers = await usersCollection.countDocuments({});

                res.send({
                    totalBalance,
                    lastSix,
                    newsletterCount,
                    paidMembers
                });
            } catch (error) {
                console.error("Chart Stats Error:", error);
                res.status(500).send({ error: "Server error fetching chart stats." });
            }
        });


        // Get paginated classes with search and max 5 trainers per class
        app.get("/paginated-classes", async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = 6;
                const search = req.query.search || "";
                const skip = (page - 1) * limit;

                const filter = {
                    name: { $regex: search, $options: "i" },
                };

                const total = await classesCollection.countDocuments(filter);

                const classes = await classesCollection
                    .find(filter)
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                const enrichedClasses = await Promise.all(
                    classes.map(async (cls) => {
                        const trainers = await usersCollection
                            .find({
                                role: "trainer",
                                skills: { $in: [cls.name] }, // ✅ THIS LINE FIXED
                            })
                            .limit(5)
                            .project({ name: 1, image: 1, _id: 1 })
                            .toArray();

                        return {
                            ...cls,
                            trainers,
                        };
                    })
                );

                res.send({ total, classes: enrichedClasses });
            } catch (error) {
                console.error("Error fetching paginated classes:", error);
                res.status(500).send({ error: "Failed to load classes" });
            }
        });





        // GET top 6 featured classes sorted by total booking count
        app.get("/classes/featured", async (req, res) => {
            try {
                const featured = await classesCollection
                    .find({})
                    .sort({ bookingCount: -1 })
                    .limit(6)
                    .toArray();

                res.send(featured);
            } catch (error) {
                console.error("Error fetching featured classes:", error);
                res.status(500).json({ message: "Internal Server Error" });
            }
        });

        // ✅ Get paginated forum posts (6 per page)
        app.get("/forums", async (req, res) => {
            const page = parseInt(req.query.page) || 1;
            const limit = 6;
            const skip = (page - 1) * limit;

            const total = await forumsCollection.countDocuments();
            const forums = await forumsCollection.find({})
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .toArray();

            res.send({ forums, total });
        });

        // ✅ Get latest forum posts for homepage (limit 6)
        app.get("/forums/latest", async (req, res) => {
            const latest = await forumsCollection.find({})
                .sort({ createdAt: -1 })
                .limit(6)
                .toArray();
            res.send(latest);
        });

        // ✅ Add new forum post (admin/trainer)
        app.post("/forums", async (req, res) => {
            const post = req.body;
            post.createdAt = new Date();
            post.upvotes = 0;
            post.downvotes = 0;
            const result = await forumsCollection.insertOne(post);
            res.send(result);
        });

        // ✅ Vote system (upvote/downvote)
        app.patch("/forums/vote/:id", async (req, res) => {
            const { id } = req.params;
            const { type } = req.body; 
            const update = type === 'upvote' ? { $inc: { upvotes: 1 } } : { $inc: { downvotes: 1 } };

            const result = await forumsCollection.updateOne(
                { _id: new ObjectId(id) },
                update
            );
            res.send(result);
        });

        // get and post api for newsletter
        app.post("/newsletter-subscribe", async (req, res) => {
            const { name, email } = req.body;
            if (!name || !email) {
                return res.status(400).json({ message: "Name and email are required" });
            }

            try {
                await newsletterCollection.insertOne({ name, email, subscribedAt: new Date() });
                res.status(200).json({ message: "Subscribed successfully" });
            } catch (err) {
                console.error("Newsletter subscription failed:", err);
                res.status(500).json({ message: "Server error" });
            }
        });

        app.get("/newsletter-subscribers", verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const allSubscribers = await newsletterCollection.find().toArray();
                res.json(allSubscribers);
            } catch (err) {
                res.status(500).json({ message: "Failed to fetch subscribers" });
            }
        });

        // GET user’s trainer application statuses (pending + rejected)
        app.get('/my-applications/:email', async (req, res) => {
            const { email } = req.params;

            try {
                const applied = await appliedTrainersCollection.find({ email }).toArray();
                const rejected = await rejectedTrainersCollection.find({ email }).toArray();

                const formattedApplied = applied.map(app => ({
                    name: app.name,
                    email: app.email,
                    status: "Pending",
                }));

                const formattedRejected = rejected.map(app => ({
                    name: app.name,
                    email: app.email,
                    status: "Rejected",
                    message: app.feedback || "No feedback provided",
                }));

                const combined = [...formattedApplied, ...formattedRejected];

                res.send(combined);
            } catch (error) {
                console.error("Error fetching applications:", error);
                res.status(500).send({ message: "Server error" });
            }
        });

        // booked trainer get api
        app.get("/booked-trainers/:email", verifyFBToken, async (req, res) => {
            try {
                const email = req.params.email;

                console.log('decoded', req.decoded);
                if (req.decoded.email !== email) {
                    return res.status(403).send({ message: 'forbidden access' })
                }


                const payments = await paymentsCollection.find({ userEmail: email }).toArray();
                res.send(payments);


            } catch (err) {
                console.error(err);
                res.status(500).send({ error: "Failed to fetch booked trainers" });
            }
        });


        // Get all reviews (for homepage testimonial slider)
        app.get('/reviews', async (req, res) => {
            try {
                const reviews = await reviewsCollection
                    .find({})
                    .sort({ createdAt: -1 })
                    .toArray();
                res.send(reviews);
            } catch (error) {
                console.error("Error fetching reviews:", error);
                res.status(500).json({ error: "Failed to fetch reviews" });
            }
        });

        // Save review to DB
        app.post('/reviews', async (req, res) => {
            const review = req.body;
            try {
                const result = await reviewsCollection.insertOne(review);
                res.send({ insertedId: result.insertedId });
            } catch (error) {
                console.error("Error saving review:", error);
                res.status(500).json({ error: "Failed to save review" });
            }
        });



        // Payment Save API
        app.post("/payments", async (req, res) => {
            try {
                const payment = req.body;

                // Save payment in DB
                const insertResult = await paymentsCollection.insertOne(payment);

                // Update booking count in the class
                const classUpdate = await classesCollection.updateOne(
                    { name: payment.className },
                    { $inc: { bookingCount: 1 } }
                );

                res.send({
                    success: true,
                    insertedId: insertResult.insertedId,
                    classUpdated: classUpdate.modifiedCount > 0,
                });
            } catch (error) {
                console.error("Error in /payments:", error);
                res.status(500).send({ success: false, message: "Payment failed to save" });
            }
        });

        // payment intent for stripe integration
        app.post('/create-payment-intent', async (req, res) => {
            const { slotId, package: packageType } = req.body;

            let amount = 1000;
            if (packageType === "standard") amount = 5000;
            if (packageType === "premium") amount = 10000;

            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount,
                    currency: 'usd',
                    payment_method_types: ['card'],
                });

                res.send({ clientSecret: paymentIntent.client_secret });
            } catch (err) {
                console.error("Stripe error:", err);
                res.status(500).send({ error: err.message });
            }
        });

        // GET all available slots
        app.get('/available-slots', async (req, res) => {
            try {
                const availableSlots = await slotsCollection.find({ isAvailable: true }).toArray();

                if (!availableSlots.length) {
                    return res.status(404).json({ message: "No available slots found" });
                }

                res.json(availableSlots);
            } catch (error) {
                console.error("Error fetching available slots:", error);
                res.status(500).json({ message: "Failed to fetch available slots" });
            }
        });

        // Route to handle slot booking and membership selection
        app.post('/book-slot', async (req, res) => {
            const { trainerId, slotId, userId, selectedPackage } = req.body;

            try {
                // Fetch the trainer's info from the users collection
                const trainer = await usersCollection.findOne({ _id: new ObjectId(trainerId) });

                if (!trainer || trainer.role !== 'trainer') {
                    return res.status(404).json({ message: 'Trainer not found or not a trainer' });
                }

                // Fetch the slot info
                const slot = await slotsCollection.findOne({ _id: new ObjectId(slotId) });
                if (!slot) {
                    return res.status(404).json({ message: 'Slot not found' });
                }

                // Save the booking information to the bookings collection
                const booking = {
                    trainerId,
                    slotId,
                    userId,
                    selectedPackage,
                    bookingStatus: 'pending', 
                    bookingTime: new Date(),
                };

                const result = await bookingsCollection.insertOne(booking);

                // Send a success response with booking info
                res.status(201).json({ message: 'Slot booked successfully', bookingId: result.insertedId });
            } catch (error) {
                console.error('Error booking slot:', error);
                res.status(500).json({ message: 'Failed to book slot. Please try again.' });
            }
        });

        // Get a specific slot by ID
        app.get('/slots/:id', async (req, res) => {
            const { id } = req.params;

            // 🔒 Validate ObjectId
            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ message: "Invalid slot ID format" });
            }

            try {
                const slot = await slotsCollection.findOne({ _id: new ObjectId(id) });

                if (!slot) {
                    return res.status(404).send({ message: 'Slot not found' });
                }

                res.send(slot);
            } catch (error) {
                console.error("Error fetching slot by ID:", error);
                res.status(500).json({ message: "Server error while fetching slot" });
            }
        });



        // Get trainer info by email
        app.get('/trainers/:email', async (req, res) => {
            const { email } = req.params;
            const trainer = await usersCollection.findOne({ email });
            if (!trainer) {
                return res.status(404).send({ message: 'Trainer not found' });
            }
            res.send(trainer);
        });

        // Increment the slot booking count
        app.patch('/slots/book/:id', async (req, res) => {
            const { id } = req.params;
            const updatedSlot = await slotsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $inc: { totalBookings: 1 } }
            );
            if (updatedSlot.modifiedCount > 0) {
                res.send({ message: 'Slot booked successfully' });
            } else {
                res.status(400).send({ message: 'Booking failed' });
            }
        });


        // Get all applied trainers
        app.get('/applied-trainers', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const appliedTrainers = await appliedTrainersCollection.find({}).toArray();
                res.json(appliedTrainers);
            } catch (error) {
                console.error("Error fetching applied trainers:", error);
                res.status(500).json({ message: "Error fetching applied trainers" });
            }
        });

        // Confirm trainer and update the user in the users collection
        app.post('/confirm-trainer', async (req, res) => {
            const { email } = req.body; 

            try {
                const appliedTrainer = await appliedTrainersCollection.findOne({ email });

                if (!appliedTrainer) {
                    return res.status(404).json({ message: 'Trainer not found in applied list' });
                }

                // Check if the user already exists in the users collection
                const existingUser = await usersCollection.findOne({ email });

                if (existingUser) {
                    if (existingUser.role === 'trainer') {
                        return res.status(400).json({ message: 'This user is already a trainer' });
                    }

                    // Update the existing user in the users collection to have the role 'trainer'
                    const updateResult = await usersCollection.updateOne(
                        { email: appliedTrainer.email },
                        { $set: { role: 'trainer', status: 'confirmed' } } 
                    );

                    if (updateResult.modifiedCount === 0) {
                        return res.status(500).json({ message: 'Failed to update user role to trainer' });
                    }
                } else {
                    // Add the confirmed trainer to the 'users' collection if they don't exist
                    const addTrainer = await usersCollection.insertOne({
                        ...appliedTrainer,
                        role: 'trainer', 
                        status: 'confirmed',
                    });

                    if (!addTrainer.acknowledged) {
                        return res.status(500).json({ message: 'Failed to add trainer to users collection' });
                    }
                }

                // Remove from the applied trainers collection
                await appliedTrainersCollection.deleteOne({ email });

                res.json({ message: 'Trainer confirmed and added to the users collection successfully!' });

            } catch (error) {
                console.error('Error confirming trainer:', error);
                res.status(500).json({ message: 'An error occurred while confirming the trainer', error });
            }
        });

        // Reject trainer (move applied trainer to 'rejected' list)
        app.delete('/reject-trainer', async (req, res) => {
            const { email, feedback } = req.body;

            if (!feedback) {
                return res.status(400).json({ message: 'Feedback is required for rejection' });
            }

            try {
                const rejectedTrainer = await appliedTrainersCollection.findOne({ email });

                if (!rejectedTrainer) {
                    return res.status(404).json({ message: 'Trainer not found for rejection' });
                }

                // Save relevant data to rejectedTrainers collection
                const rejectedDoc = {
                    name: rejectedTrainer.name,
                    email: rejectedTrainer.email,
                    feedback,
                    status: "Rejected", // Mark the trainer as rejected
                    appliedId: rejectedTrainer._id,
                    timestamp: new Date(),
                };

                await rejectedTrainersCollection.insertOne(rejectedDoc);

                // Remove from applied
                await appliedTrainersCollection.deleteOne({ email });

                res.json({ message: 'Trainer rejected successfully' });
            } catch (error) {
                console.error('Error rejecting trainer:', error);
                res.status(500).json({ message: 'An error occurred while rejecting the trainer' });
            }
        });

        // Assuming you have an endpoint to create a new slot
        app.post('/applied-trainers', async (req, res) => {
            const application = req.body;
            application.status = 'pending';
            try {
                const result = await appliedTrainersCollection.insertOne(application);
                res.send(result);
            } catch (error) {
                res.status(500).json({ message: 'Failed to submit trainer application' });
            }
        });

        // 🧑‍🏫 Save Applied Trainer
        app.post('/applied-trainers', async (req, res) => {
            const application = req.body;
            application.status = 'pending';
            const result = await db.collection('appliedTrainers').insertOne(application);
            res.send(result);
        });

        // 🔎 Get a single trainer by ID
        app.get('/trainers/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const trainer = await usersCollection.findOne(query);
            res.send(trainer);
        });


        // 🔎 Get slots by trainer email
        app.get('/slots/trainer/:email', async (req, res) => {
            const email = req.params.email;
            const query = { trainerEmail: email };
            const result = await slotsCollection.find(query).toArray();
            res.send(result);
        });

        // Server-side route to get a trainer by ID (ObjectId format)
        app.get('/trainer/:id', async (req, res) => {
            const { id } = req.params;
            try {
                // Convert the string ID to ObjectId for querying
                const trainer = await usersCollection.findOne({ _id: new ObjectId(id) });

                if (!trainer) {
                    return res.status(404).send({ message: 'Trainer not found' });
                }

                res.send(trainer);  // Send the trainer data as a response
            } catch (error) {
                console.error('Error fetching trainer:', error);
                res.status(500).send({ message: 'Server error' });
            }
        });

        // Get slots for a specific trainer by email
        app.get('/slots/trainer/:email', async (req, res) => {
            const { email } = req.params;
            try {
                const slots = await slotsCollection.find({ trainerEmail: email }).toArray();
                if (slots.length === 0) {
                    return res.status(404).json({ message: "No slots found for this trainer." });
                }
                res.json(slots);  // Send the slots data
            } catch (error) {
                console.error("Error fetching slots:", error);
                res.status(500).json({ error: "Failed to fetch slots. Please try again later." });
            }
        });

        // // GET: All slots for a specific trainer by email
        // app.get('/slots', async (req, res) => {
        //     const email = req.query.email;
        //     const query = { email };
        //     const result = await slotsCollection.find(query).toArray();
        //     res.send(result);
        // });

        // Route to fetch slots by the logged-in trainer's email
        app.get("/slots", verifyFBToken, verifyTrainer, async (req, res) => {
            const { email } = req.query; // Get trainer email from the query parameter

            // Check if the email is provided in the request
            if (!email) {
                return res.status(400).json({ error: "Email is required" });
            }

            try {
                // Find the slots that match the trainer's email
                const slots = await slotsCollection.find({ trainerEmail: email }).toArray();

                // If slots are found, return them
                if (slots.length > 0) {
                    return res.json(slots);
                } else {
                    return res.status(404).json({ message: "No slots found for this trainer." });
                }
            } catch (error) {
                console.error("Error fetching slots:", error);
                res.status(500).json({ error: "Failed to fetch slots. Please try again later." });
            }
        });

        // DELETE: Slot by ID
        // Slot deletion logic
        app.delete('/slots/:id', async (req, res) => {
            const { id } = req.params;
            try {
                const result = await slotsCollection.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount === 0) {
                    return res.status(404).send({ message: 'Slot not found' });
                }
                res.status(200).send({ message: 'Slot deleted successfully' });
            } catch (error) {
                console.error("Error deleting slot:", error);
                res.status(500).send({ message: 'Failed to delete slot' });
            }
        });

        // GET all classes
        app.get('/classes', async (req, res) => {
            const result = await classesCollection.find().toArray();
            res.send(result);
        });

        // POST: Save a new slot
        app.post('/slots', async (req, res) => {
            const slotData = req.body;
            const result = await slotsCollection.insertOne(slotData);
            res.send(result);
        });

        // POST new class
        app.post('/classes', async (req, res) => {
            const classData = req.body;
            classData.totalBookings = 0;
            const result = await classesCollection.insertOne(classData);
            res.send(result);
        });

        // 🧑‍💼 Save user
        app.post('/users', async (req, res) => {
            const user = req.body;

            // Check if user already exists by email
            const query = { email: user.email };
            const exists = await usersCollection.findOne(query);

            if (exists) {
                return res.send({ message: 'User already exists' });
            }

            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        // 🧑‍💼 Get all users
        app.get('/users', async (req, res) => {
            const users = await usersCollection.find().toArray();
            res.send(users);
        });

        // Save user to DB
        app.post('/users', async (req, res) => {
            const email = req.body.email;
            const userExists = await usersCollection.findOne({ email });
            if (userExists) return res.status(200).send({ message: 'User already exists', insertedId: false });

            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        // Get all users (admin only)
        app.get('/users', async (req, res) => {
            const users = await usersCollection.find().toArray();
            res.send(users);
        });

        // Secure API test
        app.get('/secure-data', (req, res) => {
            res.send({ message: `Welcome, ${req.user.email}` });
        });

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