/// <reference types="@types/jasmine" />
const { AceBase } = require("..");
const { createTempDB } = require("./tempdb");

describe('Examples', () => {
    /** @type {AceBase} */
    let db, removeDB;
    beforeAll(async () => {
        const tmp = await createTempDB();
        db = tmp.db;
        removeDB = tmp.removeDB;
    });

    afterAll(async () => {
        await removeDB();
    });

    it('stackoverflow answer 1', async () => {
        // See https://stackoverflow.com/questions/34562616/local-nosql-database-for-desktop-application

        // Add question to database:
        const questionRef = await db.ref('stackoverflow/questions').push({ 
            title: 'Local NoSQL database for desktop application',
            askedBy: 'tt9',
            date: new Date(),
            question: 'Is there a NoSQL database solution for desktop applications similar to Sqlite where the database is a file on the user\'s machine? ..'
        });
        
        // questionRef is now a reference to the saved database path,
        // eg: "stackoverflow/questions/ky9v13mr00001s7b829tmwk1"
        
        // Add my answer to it:
        const answerRef = await questionRef.child('answers').push({
            text: 'Use AceBase!'
        });
        
        // answerRef is now reference to the saved answer in the database, 
        // eg: "stackoverflow/questions/ky9v13mr00001s7b829tmwk1/answers/ky9v5atd0000eo7btxid7uic"
        
        // Load the question (and all answers) from the database:
        const questionSnapshot = await questionRef.get();
        
        // A snapshot contains the value and relevant metadata, such as the used reference:
        console.log(`Got question from path "${questionSnapshot.ref.path}":`, questionSnapshot.val());
        
        // We can also monitor data changes in realtime
        // To monitor new answers being added to the question:
        questionRef.child('answers').on('child_added').subscribe(newAnswerSnapshot => {
            console.log(`A new answer was added:`, newAnswerSnapshot.val());
        });
        
        // Monitor any answer's number of upvotes:
        answerRef.child('upvotes').on('value').subscribe(snapshot => {
            const prevValue = snapshot.previous();
            const newValue = snapshot.val();
            console.log(`The number of upvotes changed from ${prevValue} to ${newValue}`);
        });
        
        // Updating my answer text:
        await answerRef.update({ text: 'I recommend AceBase!' });
        
        // Or, using .set on the text itself:
        await answerRef.child('text').set('I can really recommend AceBase');
        
        // Adding an upvote to my answer using a transaction:
        await answerRef.child('upvotes').transaction(snapshot => {
            let upvotes = snapshot.val();
            return upvotes + 1; // Return new value to store
        });
        
        // Query all given answers sorted by upvotes:
        let querySnapshots = await questionRef.child('answers')
            .query()
            .sort('upvotes', false) // descending order, most upvotes first
            .get();
        
        // Limit the query results to the top 10 with "AceBase" in their answers:
        querySnapshots = await questionRef.child('answers')
            .query()
            .filter('text', 'like', '*AceBase*')
            .take(10)
            .sort('upvotes', false) // descending order, most upvotes first
            .get();

        // We can also load the question in memory and make it "live":
        // The in-memory value will automatically be updated if the database value changes, and
        // all changes to the in-memory object will automatically update the database:
        const questionProxy = await questionRef.proxy();
        const liveQuestion = questionProxy.value;

        // Changing a property updates the database automatically:
        liveQuestion.tags = ['node.js','database','nosql'];

        // ... db value of tags is updated in the background ...

        // And changes to the database will update the liveQuestion object:
        let now = new Date();
        await questionRef.update({ edited: now });

        // In the next tick, the live proxy value will have updated:
        process.nextTick(() => {
            liveQuestion.edited === now; // true
        });
    });
});