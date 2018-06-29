const { AceBase } = require('acebase');

class User {
    constructor(from) {
        if (from) {
            this.name = from.name;
            this.born = from.born;
            this.pets = from.pets || [];
        }
        if (!this.pets) {
            this.pets = [];
        }
    }
    addPet(pet) {
        this.pets.push(pet);
    }
    serialize() {
        // This method is called when saving to the database
        return { 
            name: this.name, 
            born: this.born,
            pets: this.pets
        };
    }
}

class Pet {
    constructor(animal, name) {
        this.animal = animal;
        this.name = name;
    }
    static from(obj) {
        return new Pet(obj.animal, obj.name);
    }
}

/**
 * 
 * @param {AceBase} db 
 */
const run = (db) => {
    // Add type mapping for nodes at "users" to a custom User class
    db.types.bind("users", User); // serializes the objects using the implemented .serialize method, instantiates objects with "new User(obj)"
    // Add type mapping for child nodes of any user's "pets" node
    db.types.bind("users/*/pets", Pet.from, { instantiate: false }); 

    let ewout = new User();
    ewout.name = "Ewout Stortenbeker";
    ewout.born = new Date("1978-06-21T12:00:00Z"); // Set to noon UTC, so it's the 21st in any timezone
    
    let pet = new Pet("goldfish", "fishy");
    ewout.addPet(pet);
    ewout.addPet(new Pet("rabbit", "bunny"));
    ewout.addPet(new Pet("rabbit", "fluffy"));

    db.ref("users/ewout")
    .update(ewout)
    .then(ref => {
        console.log("User saved");
        return ref.once("value");
    })
    .then(snap => {
        let user = snap.val();
        console.log(user);
        console.assert(user instanceof User, `user MUST be an instance of User!`); // true
        console.assert(typeof user.addPet === "function", "If the above is true, this must be too!");
        console.assert(user.pets[0] instanceof Pet, `user.pets[0] MUST be an instance of Pet!`); // true
    });
};

module.exports = run;