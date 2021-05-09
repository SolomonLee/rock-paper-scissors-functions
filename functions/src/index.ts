import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
admin.initializeApp();

export const onGameRoomsUpdate = 
functions.firestore.document("game-rooms/jaAuUvGE5ywBOFNU7SxU").onUpdate(change => {
        const after = change.after.data();
        const payload = {
            data: {
                temp: String(after["room-name"])
            }
        }

        return admin.messaging().sendToTopic("room_name", payload);
})

export const getGameRooms = functions.https.onRequest((request, response) => {
    const gameRoomNames: string[] = [];

    admin.firestore().collection("game-rooms").get()
    .then((querySnapshot) => {
        querySnapshot.forEach((doc) => {
            gameRoomNames.push(doc.data()["room-name"]);
        });

        response.send(gameRoomNames);
    })
    .catch(error => {
        // Handle the error
        console.log(error);
        response.status(500).send("出現未知的錯誤");
    });
});
