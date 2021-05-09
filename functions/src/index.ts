import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { successLog, errorLog } from "./common/log";
import { verificationDataFields, authVerification } from "./common/auth";
import * as errorNames from "./common/errorNames";
import { resultOk, resultError } from "./common/result";

admin.initializeApp();

const collection = (collectionname: string) =>
    admin.firestore().collection(collectionname);

// ===== User : START
// 當建立新USER 自動建立玩家資訊
export const onCreateUser = functions.auth.user().onCreate(async (user) => {
    const name =
        typeof user.email == "string"
            ? user.email.slice(0, user.email.indexOf("@"))
            : Date.now().toString();

    return collection("gamers")
        .doc(user.uid)
        .set({
            ["email"]: user.email,
            ["name"]: name,
            ["join-game-room-id"]: "",
        })
        .then(() => {
            successLog(`New User email: ${user.email}`, onCreateUser.name);
        });
}); // onCreateUser()

// ===== User : END

// ===== Gamer : START
interface Gamer {
    /** doc ID. */
    email: string;
    gamerName: string;
    joinGameRoomId: string;
} // Gamer

// 取得玩家資訊
export const getGamerInfo = functions.https.onCall(async (data, context) => {
    const auth = authVerification(context);

    const gamer: Gamer = {
        email: "",
        gamerName: "",
        joinGameRoomId: "",
    };

    if (auth === false) {
        return resultError(errorNames.authErrorList.unauthenticated, gamer);
    }

    try {
        const doc = await collection("gamers").doc(auth.uid).get();

        if (doc.exists) {
            const data = doc.data() || false;

            if (data !== false) {
                gamer.email = data.email;
                gamer.gamerName = data.name;
                gamer.joinGameRoomId = data["join-game-room-id"];

                return resultOk(gamer);
            }
        }
    } catch (e) {
        errorLog(`_getGamerInfo: #1 ${e}`, getGamerInfo.name);
    }

    return resultError(errorNames.gamerErrorList.onFindGamerInfo, gamer);
}); // getGamerInfo()

// 設定玩家名稱
export const updateGamerName = functions.https.onCall(async (data, context) => {
    const auth = authVerification(context);

    if (auth === false) {
        return resultError(errorNames.authErrorList.unauthenticated);
    }

    const errorMsg = verificationDataFields(data, {
        name: { type: "string", isRequirement: true, default: null },
    });
    if (errorMsg.length) {
        return resultError(errorNames.typeErrorList.noString);
    }

    await collection("gamers").doc(auth.uid).update({
        name: data.name,
    });

    return resultOk();
}); // updateGamerName()

// 設定玩家加入之房間
// const updateGamerJoinGameRoomId = async (
//     data: any,
//     context: functions.https.CallableContext
// ) => {
//     const auth = authVerification(context);

//     if (auth === false) {
//         return errorNames.authErrorList.authFail;
//         // return resultError(errorNames.authErrorList.unauthenticated);
//     }

//     const errorMsg = verificationDataFields(data, {
//         joinGameRoomId: {
//             type: "string",
//             isRequirement: true,
//             default: null,
//         },
//     });
//     if (errorMsg.length) {
//         return errorMsg;
//     }

//     await collection("gamers")
//         .doc(auth.uid)
//         .update({
//             ["join-game-room-id"]: data.joinGameRoomId,
//         });

//     return "";
// };
// ===== Gamer : END

// ===== GameRooms : START
interface Room {
    /** doc ID. */
    roomId: string;
    creator: string;
    gameConditionKey: string;
    gameConditionValue: string;
    loserAward: string;
    winnerAward: string;
    roomName: string;
    /** Waiting|Start|End */
    statue: string;
    winners: string[];
    timestamp: number;
    gamers: string[];
} // Room

export const getRooms = functions.https.onCall(async (data, context) => {
    const auth = authVerification(context);

    if (auth === false) {
        return resultError(errorNames.authErrorList.unauthenticated);
    }

    try {
        const querySnapshot = await collection("game-rooms")
            .orderBy("timestamp", "desc")
            .get();

        const rooms: Room[] = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            rooms.push({
                roomId: doc.id,
                creator: data.creator,
                gameConditionKey: data["game-condition-key"],
                gameConditionValue: data["game-condition-value"],
                loserAward: data["loser-award"],
                winnerAward: data["winner-award"],
                roomName: data["room-name"],
                statue: data["statue"],
                winners: data["winners"],
                gamers: data["gamers"],
                timestamp: data["timestamp"],
            });
        });

        return resultOk({ rooms });
    } catch (error) {
        errorLog("", getRooms.name);
    }
    return resultError("發生了一些意外, 無法取得房間資訊!!");
}); // getRooms()

export const insertRoom = functions.https.onCall(async (data, context) => {
    const auth = authVerification(context);

    if (auth === false) {
        return resultError(errorNames.authErrorList.unauthenticated);
    }

    const errorMsg = verificationDataFields(data, {
        creator: { type: "string", isRequirement: true, default: null },
        gameConditionKey: {
            type: "string",
            isRequirement: true,
            default: null,
        },
        gameConditionValue: {
            type: "number",
            isRequirement: true,
            default: null,
        },
        loserAward: { type: "string", isRequirement: true, default: null },
        winnerAward: { type: "string", isRequirement: true, default: null },
        roomName: { type: "string", isRequirement: true, default: null },
    });

    if (errorMsg.length) {
        return resultError(errorMsg);
    }

    try {
        const roomInfo: Room = {
            ...data,
            statue: "Waiting",
            gamers: [],
            winners: [],
            timestamp: Date.now(),
        };

        const result = await collection("game-rooms").add(roomInfo);
        roomInfo.roomId = result.id;

        return resultOk({ roomInfo });
    } catch (error) {
        errorLog("", getRooms.name);
    }
    return resultError("");
}); // insertRoom()
// ===== GameRooms : END

// ===== GameConditions : START
interface GameCondition {
    /** doc ID. */
    conditionId: string;
    name: string;
    /** 玩法描述. */
    description: string;
} // GameCondition

export const getGameConditions = functions.https.onCall(
    async (data, context) => {
        const auth = authVerification(context);

        if (auth === false) {
            return resultError(errorNames.authErrorList.unauthenticated);
        }
        try {
            const querySnapshot = await collection("game-rooms")
                .orderBy("timestamp", "desc")
                .get();

            const gameConditions: GameCondition[] = [];
            querySnapshot.forEach((doc) => {
                const data = doc.data();

                gameConditions.push({
                    conditionId: doc.id,
                    name: data.name,
                    description: data.description,
                });
            });

            return resultOk({ gameConditions });
        } catch (error) {
            errorLog("", getGameConditions.name);
        }
        return resultError("取得 遊戲條件列表 失敗!");
    }
); // getGameConditions()
// ===== GameConditions : END

// export const onGameRoomsUpdate = functions.firestore
//     .document("game-rooms/jaAuUvGE5ywBOFNU7SxU")
//     .onUpdate((change) => {
//         const after = change.after.data();
//         const payload = {
//             data: {
//                 temp: String(after["room-name"]),
//             },
//         };

//         return admin.messaging().sendToTopic("room_name", payload);
//     });

// export const getGameRooms = functions.https.onRequest((req, res) => {
//     const gameRoomNames: string[] = [];

//     admin
//         .firestore()
//         .collection("game-rooms")
//         .get()
//         .then((querySnapshot) => {
//             querySnapshot.forEach((doc) => {
//                 gameRoomNames.push(doc.data()["room-name"]);
//             });

//             res.send(gameRoomNames);
//         })
//         .catch((error) => {
//             // Handle the error
//             console.log(error);
//             res.status(500).send("出現未知的錯誤");
//         });
// });
