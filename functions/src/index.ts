import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { successLog, errorLog } from "./common/log";
import { verificationDataFields, authVerification } from "./common/auth";
import * as errorNames from "./common/errorNames";
import { resultOk, resultError, Result } from "./common/result";

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

// 取得玩家所參加的房間ID
export const getGamerJoinRoomId = functions.https.onCall(
    async (data, context) => {
        const auth = authVerification(context);

        let joinGameRoomId = "";

        if (auth === false) {
            return resultError(
                errorNames.authErrorList.unauthenticated,
                joinGameRoomId
            );
        }

        try {
            const doc = await collection("gamers").doc(auth.uid).get();

            if (doc.exists) {
                const data = doc.data() || false;

                if (data !== false) {
                    joinGameRoomId = data["join-game-room-id"];

                    return resultOk(joinGameRoomId);
                }
            }
        } catch (e) {
            errorLog(`getGamerJoinRoomId: #1 ${e}`, getGamerInfo.name);
        }

        return resultError(
            errorNames.gamerErrorList.onFindGamerInfo,
            joinGameRoomId
        );
    }
); // getGamerInfo()

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
// ===== Gamer : END

// ===== GameRooms : START
interface RoomGamerState {
    name: string;
    ready: boolean;
    result: string;
}

interface RoomGamers {
    [email: string]: RoomGamerState;
}

interface RoomState {
    gamers: RoomGamers;
    /** Waiting|Start|End */
    state: string;
    roomMaster: string;
}

// interface RoomChoose {
/** 存放玩家 Email : 剪刀 石頭 布 */
//     [email: string]: string;
// }

interface Room {
    /** doc ID. */
    roomId: string;
    creator: string;
    gameConditionKey: string;
    gameConditionValue: string;
    loserAward: string;
    winnerAward: string;
    roomName: string;
    winners: string[];
    timestamp: number;
    roomState: RoomState;
} // Room

// interface RoomResult extends Room {
//     roomChoose: RoomChoose;
// }

export const getGameRooms = functions.https.onCall(
    async (/* data, context*/) => {
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
                    roomState: <RoomState>{
                        gamers: data["room-state"]["gamers"],
                        roomMaster: data["room-state"]["room-master"],
                        state: data["room-state"]["state"],
                    },
                    winners: data["winners"],
                    timestamp: data["timestamp"],
                });
            });

            return resultOk(rooms);
        } catch (error) {
            errorLog("", getGameRooms.name);
        }
        return resultError("發生了一些意外, 無法取得房間資訊!!", []);
    }
); // getGameRooms()

export const insertGameRoom = functions.https.onCall(async (data, context) => {
    console.log(`insertGameRoom Start`);

    const auth = authVerification(context);
    console.log(`insertGameRoom #1`);

    if (auth === false) {
        return resultError(errorNames.authErrorList.unauthenticated);
    }

    console.log(`insertGameRoom #2`);
    const errorMsg = verificationDataFields(data, {
        // creator: { type: "string", isRequirement: true, default: null },
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
    console.log(`insertGameRoom #3`);

    if (errorMsg.length) {
        return resultError(errorMsg, <Room>{});
    }

    console.log(`insertGameRoom #4`);
    try {
        console.log(`insertGameRoom #5`);
        const roomInfo = {
            ["game-condition-key"]: data.gameConditionKey,
            ["game-condition-value"]: data.gameConditionValue,
            ["loser-award"]: data.loserAward,
            ["winner-award"]: data.winnerAward,
            ["room-name"]: data.roomName,
            winners: [],
            timestamp: Date.now(),
            ["room-state"]: {
                gamers: {},
                state: "Waiting",
                ["room-master"]: "",
            },
            ["room-gamer-choose"]: {},
            creator: "",
        };

        console.log(`insertGameRoom #6 auth.uid:${auth.uid}, `);
        const resultGamer = await collection("gamers").doc(auth.uid).get();
        const dataGamer = resultGamer.data();

        console.log(`insertGameRoom #7`);
        if (typeof dataGamer === "undefined") return resultError("", <Room>{});

        console.log(`insertGameRoom #8`);
        roomInfo.creator = dataGamer["email"];

        const result = await collection("game-rooms").add(roomInfo);

        const roomResult = <Room>{
            ...data,
            winners: roomInfo.winners,
            timestamp: roomInfo.timestamp,
            roomState: roomInfo["room-state"],
            creator: roomInfo.creator,
            roomId: result.id,
        };

        console.log(`insertGameRoom #9`);
        return resultOk(roomResult);
    } catch (error) {
        console.log(`insertGameRoom #10`);
        errorLog("新增房間發生錯誤 #1", insertGameRoom.name);
    }
    console.log(`insertGameRoom #11`);
    return resultError("", <Room>{});
}); // insertGameRoom()
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
    async (/* data, context*/) => {
        try {
            const querySnapshot = await collection("game-condition")
                .orderBy("name", "asc")
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

            return resultOk(gameConditions);
        } catch (error) {
            errorLog("", getGameConditions.name);
        }
        return resultError("取得 遊戲條件列表 失敗!", []);
    }
); // getGameConditions()
// ===== GameConditions : END

// ===== Receptionist : START
export const joinGameRoom = functions.https.onCall(async (data, context) => {
    const auth = authVerification(context);

    if (auth === false) {
        return resultError(errorNames.authErrorList.unauthenticated);
    }

    const errorMsg = verificationDataFields(data, {
        roomId: { type: "string", isRequirement: true, default: null },
    });

    if (errorMsg.length) {
        return resultError(errorMsg, false);
    }

    if (data.roomId.length === 0) {
        return resultError("請輸入房間代號", false);
    }

    try {
        const promiseDocRoom = collection("game-rooms").doc(data.roomId).get();

        const promiseDocGamer = collection("gamers").doc(auth.uid).get();

        Promise.all([promiseDocRoom, promiseDocGamer]).then(
            ([docRoom, docGamer]): Result => {
                if (!docRoom.exists) {
                    return resultError("不存在的房間", false);
                }

                if (!docGamer.exists) {
                    return resultError("發生異常, 請重新登入! #1", false);
                }

                const dataGamer = docGamer.data();
                const dataRoom = docRoom.data();

                if (
                    typeof dataGamer === "undefined" ||
                    typeof dataRoom === "undefined" ||
                    dataRoom["room-state"].state !== "Waiting"
                ) {
                    return resultError("發生異常, 請重新登入! #2", false);
                }

                /** 回到原來房間 */
                if (dataGamer["join-game-room-id"] === data.roomId) {
                    return resultOk();
                }

                if (dataGamer["join-game-room-id"] !== "") {
                    return resultError(
                        "已加入房間的玩家, 不行加入其他房間",
                        false
                    );
                }

                /** 更新 Room Id 至玩家 */
                const promiseUpdateGamerJoinId = collection("gamers")
                    .doc(auth.uid)
                    .update({
                        ["join-game-room-id"]: data.roomId,
                    });

                /** 判斷是否為空房 是的話剛加入的那位即是房主 */
                let updateInfo;
                if (dataRoom["room-state"]["room-master"] === "") {
                    updateInfo = {
                        ["room-state"]: {
                            ["gamers"]: admin.firestore.FieldValue.arrayUnion({
                                [dataGamer.email]: {
                                    name: dataGamer.name,
                                    ready: false,
                                    result: "gaming",
                                    prevChoose: "",
                                },
                            }),
                            ["room-master"]: dataGamer.email,
                        },
                        ["room-gamers-choose"]: admin.firestore.FieldValue.arrayUnion(
                            {
                                [dataGamer.email]: "",
                            }
                        ),
                    };
                } else {
                    updateInfo = {
                        ["room-state"]: {
                            ["gamers"]: admin.firestore.FieldValue.arrayUnion({
                                [dataGamer.email]: {
                                    name: dataGamer.name,
                                    ready: false,
                                    result: "gaming",
                                    prevChoose: "",
                                },
                            }),
                        },
                        ["room-gamers-choose"]: admin.firestore.FieldValue.arrayUnion(
                            {
                                [dataGamer.email]: "",
                            }
                        ),
                    };
                }

                /** 將玩家資訊 加到 room-state 內 */
                const promiseUpdateRoomState = collection("game-rooms")
                    .doc(data.roomId)
                    .update(updateInfo);

                Promise.all([
                    promiseUpdateGamerJoinId,
                    promiseUpdateRoomState,
                ]).then(() => {
                    return resultOk(data.roomId);
                });

                return resultError("加入 遊戲失敗!", false);
            }
        );
    } catch (error) {
        errorLog("", joinGameRoom.name);
    }

    return resultError("加入遊戲 失敗!", false);
}); // joinGameRoom()

export const leaveGameRoom = functions.https.onCall(async (data, context) => {
    const auth = authVerification(context);

    if (auth === false) {
        return resultError(errorNames.authErrorList.unauthenticated);
    }

    const errorMsg = verificationDataFields(data, {
        roomId: { type: "string", isRequirement: true, default: null },
    });

    if (errorMsg.length) {
        return resultError(errorMsg, false);
    }

    try {
        const promiseDocRoom = collection("game-rooms").doc(data.roomId).get();

        const promiseDocGamer = collection("gamers").doc(auth.uid).get();

        Promise.all([promiseDocRoom, promiseDocGamer]).then(
            ([docRoom, docGamer]): Result => {
                if (!docRoom.exists) {
                    return resultError("不存在的房間", false);
                }

                if (!docGamer.exists) {
                    return resultError("發生異常, 請重新登入! #1", false);
                }

                const dataGamer = docGamer.data();
                const dataRoom = docRoom.data();

                if (
                    typeof dataGamer === "undefined" ||
                    typeof dataRoom === "undefined" ||
                    dataRoom["room-state"].state !== "Waiting"
                ) {
                    return resultError("發生異常, 請重新登入! #2", false);
                }

                /** 當玩家所加入的房間 不是此 房間 */
                if (dataGamer["join-game-room-id"] !== data.roomId) {
                    return resultError("發生異常, 請重新登入! #3", false);
                }

                const promiseArray = [];
                /** 更新 Room Id = "" 至玩家 */
                promiseArray.push(
                    collection("gamers")
                        .doc(auth.uid)
                        .update({
                            ["join-game-room-id"]: "",
                        })
                );

                // 是否為空房 是的話剛加入的那位即是房主
                const roomState = dataRoom["room-state"];
                /** 判斷離開後始否為空房 */
                if (Object.keys(roomState["gamers"]).length <= 1) {
                    promiseArray.push(
                        collection("game-rooms").doc(data.roomId).delete()
                    );
                } else {
                    let updateInfo;
                    if (roomState["room-master"] === dataGamer.email) {
                        let nextRoomMaster = "";

                        for (const [email] of Object.entries(
                            roomState["gamers"]
                        )) {
                            if (email != roomState["room-master"]) {
                                nextRoomMaster = email;
                                break;
                            }
                        }

                        updateInfo = {
                            ["room-state"]: {
                                ["gamers"]: admin.firestore.FieldValue.arrayRemove(
                                    dataGamer.email
                                ),
                                ["room-master"]: nextRoomMaster,
                            },
                            ["room-gamers-choose"]: admin.firestore.FieldValue.arrayRemove(
                                [dataGamer.email]
                            ),
                        };
                    } else {
                        updateInfo = {
                            ["room-state"]: {
                                ["gamers"]: admin.firestore.FieldValue.arrayRemove(
                                    dataGamer.email
                                ),
                            },
                            ["room-gamers-choose"]: admin.firestore.FieldValue.arrayRemove(
                                [dataGamer.email]
                            ),
                        };
                    }

                    promiseArray.push(
                        collection("game-rooms")
                            .doc(data.roomId)
                            .update(updateInfo)
                    );
                }

                Promise.all(promiseArray).then(() => {
                    return resultOk(true);
                });

                return resultError("離開遊戲 失敗!", false);
            }
        );
    } catch (error) {
        errorLog("", leaveGameRoom.name);
    }

    return resultError("離開 遊戲失敗!", false);
}); // leaveGameRoom()
// ===== Receptionist : END
