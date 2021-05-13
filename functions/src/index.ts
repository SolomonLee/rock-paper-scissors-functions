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

/** 對應客戶端 */
interface Gamer {
    email: string;
    gamerName: string;
    joinGameRoomId: string;
} // Gamer

/** 對應資料庫欄位 */
interface GamerDoc {
    ["join-game-room-id"]: string;
    email: string;
    name: string;
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
const roomStateMap = {
    Waiting: "Waiting",
    Start: "Start",
    End: "End",
};

const gamerResultMap = {
    Gaming: "gaming",
    Winner: "winner",
    Loser: "loser",
};

/** 用於新增房間, 基本欄位 */
interface RoomBaseData {
    roomName: string;
    gameConditionKey: string;
    gameConditionValue: number;
    loserAward: string;
    winnerAward: string;
}

/** 對應資料庫欄位 */
interface Room extends RoomBaseData {
    winners: string[];
    timestamp: number;
    roomMaster: string;
    /** Waiting|Start|End */
    state: string;
} // Room

/** 對應客戶端欄位 */
interface RoomClientData extends Room {
    /** doc ID. */
    gamers: number;
    roomId: string;
} // RoomClientData

export const getGameRooms = functions.https.onCall(async () => {
    try {
        console.log("getGameRooms Start");
        console.log("getGameRooms #0");

        const collectionGameRooms = await collection("game-rooms")
            .orderBy("timestamp", "desc")
            .get();

        console.log("getGameRooms #1");
        const rooms: RoomClientData[] = [];
        const promiseArray: Promise<Result>[] = [];
        console.log("getGameRooms #2");
        collectionGameRooms.forEach((doc) => {
            const room = doc.data() as Room;

            if (room.state !== roomStateMap.Waiting) return;

            console.log("getGameRooms #3 in forEach ");
            promiseArray.push(
                collection("game-rooms")
                    .doc(doc.id)
                    .collection("gamers")
                    .get()
                    .then((querySnapshot) => {
                        console.log(
                            "getGameRooms #4 in get collection: gamers"
                        );
                        rooms.push({
                            ...room,
                            gamers: querySnapshot.docs.length,
                            roomId: doc.id,
                        });

                        return resultOk();
                    })
            );
        });

        console.log("getGameRooms #5", promiseArray);
        await Promise.all(promiseArray);

        console.log("getGameRooms #6");
        return resultOk(rooms);
    } catch (error) {
        errorLog("", getGameRooms.name);
    }
    return resultError("發生了一些意外, 無法取得房間資訊!!", []);
}); // getGameRooms()

export const insertGameRoom = functions.https.onCall(async (data, context) => {
    const auth = authVerification(context);

    // 驗證 客戶端 來源資料
    {
        if (auth === false) {
            return resultError(errorNames.authErrorList.unauthenticated);
        }

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
    }

    const roomBaseData = data as RoomBaseData;
    try {
        const roomInfo: Room = {
            ...roomBaseData,
            winners: [],
            timestamp: Date.now(),
            state: roomStateMap.Waiting,
            roomMaster: "",
        };

        const result = await collection("game-rooms").add(roomInfo);

        const roomResult = <RoomClientData>{
            ...roomInfo,
            roomId: result.id,
            gamers: 0,
        };

        return resultOk(roomResult);
    } catch (error) {
        errorLog("新增房間發生錯誤 #1", insertGameRoom.name);
    }
    return resultError("", <Room>{});
}); // insertGameRoom()
// ===== GameRooms : END

// ===== GameConditions : START
interface GameConditionBase {
    name: string;
    /** 玩法描述. */
    description: string;
} // GameCondition

interface GameCondition extends GameConditionBase {
    /** doc ID. */
    conditionId: string;
} // GameCondition

export const getGameConditions = functions.https.onCall(
    async (/* data, context*/) => {
        try {
            const querySnapshot = await collection("game-condition")
                .orderBy("name", "asc")
                .get();

            const gameConditions: GameCondition[] = [];
            querySnapshot.forEach((doc) => {
                const gameConditionBase = doc.data() as GameConditionBase;

                gameConditions.push({
                    ...gameConditionBase,
                    conditionId: doc.id,
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

    // 初始驗證
    {
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
    }

    try {
        const promiseDocRoom = collection("game-rooms").doc(data.roomId).get();
        const promiseDocGamer = collection("gamers").doc(auth.uid).get();

        const result = await Promise.all([
            promiseDocRoom,
            promiseDocGamer,
        ]).then(
            async ([docRoom, docGamer]): Promise<Result> => {
                // 二次驗證
                {
                    if (!docRoom.exists) {
                        return resultError("不存在的房間", false);
                    }

                    if (!docGamer.exists) {
                        return resultError("發生異常, 請重新登入! #1", false);
                    }
                }

                const dataGamer = docGamer.data() as GamerDoc;
                const dataRoom = docRoom.data() as Room;

                // 二次驗證
                {
                    if (
                        typeof dataGamer === "undefined" ||
                        typeof dataRoom === "undefined" ||
                        dataRoom.state !== roomStateMap.Waiting
                    ) {
                        return resultError("發生異常, 請重新登入! #2", false);
                    }

                    /** 回到原來房間 */
                    if (dataGamer["join-game-room-id"] === data.roomId) {
                        return resultOk(data.roomId);
                    }

                    if (dataGamer["join-game-room-id"] !== "") {
                        return resultError(
                            "已加入房間的玩家, 不行加入其他房間",
                            false
                        );
                    }
                }

                const promiseArr = [];
                /** 更新 Room Id 至玩家 */
                promiseArr.push(
                    collection("gamers")
                        .doc(auth.uid)
                        .update({
                            ["join-game-room-id"]: data.roomId,
                        })
                        .catch(() => {
                            errorLog("err #1", joinGameRoom.name);
                        })
                );

                /** 判斷是否為空房 是的話剛加入的那位即是房主 */
                if (dataRoom.roomMaster === "") {
                    promiseArr.push(
                        collection("game-rooms")
                            .doc(data.roomId)
                            .update({
                                roomMaster: dataGamer.email,
                            })
                            .catch(() => {
                                errorLog("err #2", joinGameRoom.name);
                            })
                    );
                }

                /** 加入 玩家列表 */
                promiseArr.push(
                    collection("game-rooms")
                        .doc(data.roomId)
                        .collection("gamers")
                        .doc(dataGamer.email)
                        .set({
                            name: dataGamer.name,
                            ready: false,
                            result: gamerResultMap.Gaming,
                            prevChoose: "",
                            score: 0,
                        })
                        .catch(() => {
                            errorLog("err #3", joinGameRoom.name);
                        })
                );

                /** 加入 玩家真實選擇列表 */
                promiseArr.push(
                    collection("game-rooms")
                        .doc(data.roomId)
                        .collection("room-gamers-choose")
                        .doc(dataGamer.email)
                        .set({
                            nowChoose: "",
                        })
                        .catch(() => {
                            errorLog("err #4", joinGameRoom.name);
                        })
                );

                const resultFinal = await Promise.all(promiseArr)
                    .then(() => {
                        return resultOk(data.roomId);
                    })
                    .catch(() => {
                        return resultError("加入 遊戲失敗!", false);
                    });

                return resultFinal;
            }
        );

        return result;
    } catch (error) {
        errorLog("", joinGameRoom.name);
    }

    return resultError("加入遊戲 失敗!", false);
}); // joinGameRoom()

export const leaveGameRoom = functions.https.onCall(async (data, context) => {
    const auth = authVerification(context);

    //  初始驗證
    {
        if (auth === false) {
            return resultError(errorNames.authErrorList.unauthenticated, false);
        }

        const errorMsg = verificationDataFields(data, {
            roomId: { type: "string", isRequirement: true, default: null },
        });

        if (errorMsg.length) {
            return resultError(errorMsg, false);
        }
    }

    try {
        const promiseDocRoom = collection("game-rooms").doc(data.roomId).get();
        const promiseDocGamer = collection("gamers").doc(auth.uid).get();
        const promiseRoomGamers = collection("game-rooms")
            .doc(data.roomId)
            .collection("gamers")
            .get();

        const result = await Promise.all([
            promiseRoomGamers,
            promiseDocRoom,
            promiseDocGamer,
        ]).then(
            async ([docRoomGamers, docRoom, docGamer]): Promise<Result> => {
                // 二次驗證
                {
                    if (!docRoom.exists) {
                        return resultError("不存在的房間", false);
                    }

                    if (!docGamer.exists) {
                        return resultError("發生異常, 請重新登入! #1", false);
                    }
                }

                const dataGamer = docGamer.data() as GamerDoc;
                const dataRoom = docRoom.data() as Room;

                // 二次驗證
                {
                    if (
                        typeof dataGamer === "undefined" ||
                        typeof dataRoom === "undefined"
                    ) {
                        return resultError("發生異常, 請重新登入! #2", false);
                    }

                    /** 遊戲已經開始 */
                    if (dataRoom.state === roomStateMap.Start) {
                        return resultError("開始中, 無法退出遊戲! #3", false);
                    }

                    /** 當玩家所加入的房間 不是此 房間 */
                    if (dataGamer["join-game-room-id"] !== data.roomId) {
                        return resultError("發生異常, 請重新登入! #4", false);
                    }
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

                /** 判斷離開後始否為空房 */
                if (docRoomGamers.docs.length <= 1) {
                    promiseArray.push(
                        collection("game-rooms")
                            .doc(data.roomId)
                            .collection("gamers")
                            .doc(dataGamer.email)
                            .delete()
                    );
                    promiseArray.push(
                        collection("game-rooms")
                            .doc(data.roomId)
                            .collection("room-gamers-choose")
                            .doc(dataGamer.email)
                            .delete()
                    );
                    promiseArray.push(
                        collection("game-rooms").doc(data.roomId).delete()
                    );
                } else {
                    /** 非空房時 */

                    /** 是否為房主 */
                    if (dataRoom.roomMaster === dataGamer.email) {
                        let masterName = "";
                        docRoomGamers.forEach((docRoomGamer) => {
                            if (
                                masterName === "" &&
                                docRoomGamer.id !== dataGamer.email
                            ) {
                                masterName = docRoomGamer.id;
                            }
                        });

                        promiseArray.push(
                            collection("game-rooms").doc(data.roomId).update({
                                roomMaster: masterName,
                            })
                        );
                    }

                    promiseArray.push(
                        collection("game-rooms")
                            .doc(data.roomId)
                            .collection("gamers")
                            .doc(dataGamer.email)
                            .delete()
                    );

                    promiseArray.push(
                        collection("game-rooms")
                            .doc(data.roomId)
                            .collection("room-gamers-choose")
                            .doc(dataGamer.email)
                            .delete()
                    );
                }

                const resultFinal = await Promise.all(promiseArray).then(() => {
                    return resultOk(true);
                });

                return resultFinal;
            }
        );

        return result;
    } catch (error) {
        errorLog("", leaveGameRoom.name);
    }

    return resultError("離開 遊戲失敗!", false);
}); // leaveGameRoom()
// ===== Receptionist : END

// ===== Judge : START
/** 獲勝條件 */
const gameConditionAllowArr = ["4gxgWJvbrUA55j5B7SzK", "GnQBE5XJjS7g6NOp5ytn"];
const gameConditionMap = {
    /** 4gxgWJvbrUA55j5B7SzK : 依照獲勝場數, 選出最終獲得勝利的玩家  */
    cA: "4gxgWJvbrUA55j5B7SzK",
    /** GnQBE5XJjS7g6NOp5ytn : 希望最終剩下多少最終優勝者  */
    cB: "GnQBE5XJjS7g6NOp5ytn",
};

/** 剪刀石頭布 對上 客戶端資料 */
const rpsAllowArr = ["石頭", "布", "剪刀"];

/** 剪刀石頭布 對上 客戶端資料 */
const rpsNameMap = {
    Rock: "石頭",
    Paper: "布",
    Scissors: "剪刀",
};

/** 剪刀石頭布 勝負 條件 */
const mapAllRockPaperScissors = {
    [rpsNameMap.Rock]: {
        [rpsNameMap.Paper]: {
            [rpsNameMap.Paper]: true,
            [rpsNameMap.Rock]: false,
        },
        [rpsNameMap.Scissors]: {
            [rpsNameMap.Scissors]: false,
            [rpsNameMap.Rock]: true,
        },
    },

    [rpsNameMap.Paper]: {
        [rpsNameMap.Rock]: {
            [rpsNameMap.Rock]: false,
            [rpsNameMap.Paper]: true,
        },
        [rpsNameMap.Scissors]: {
            [rpsNameMap.Scissors]: true,
            [rpsNameMap.Paper]: false,
        },
    },
    [rpsNameMap.Scissors]: {
        [rpsNameMap.Paper]: {
            [rpsNameMap.Paper]: false,
            [rpsNameMap.Scissors]: true,
        },
        [rpsNameMap.Rock]: {
            [rpsNameMap.Rock]: true,
            [rpsNameMap.Scissors]: false,
        },
    },
};

/** 對應 資料庫集合 Gamer, 用於 onSnapshot */
interface RoomGamer {
    name: string;
    ready: boolean;
    /** gaming|winner|loser */
    result: string;
    prevChoose: string;
    /** 當用勝場數時使用 */
    score: number;
}

interface RoomGamers {
    [email: string]: RoomGamer;
}

interface RoomGamerChoose {
    nowChoose: string;
}

interface RoomGamerChooses {
    [email: string]: RoomGamerChoose;
}

// 首次才需要開始遊戲, 當遊戲進行中時, 全部玩家 Ready 即開始
export const gameStart = functions.https.onCall(async (data, context) => {
    const auth = authVerification(context);
    console.log("gameStart!! #1");

    //  初始驗證
    {
        if (auth === false) {
            return resultError(errorNames.authErrorList.unauthenticated, false);
        }

        const errorMsg = verificationDataFields(data, {
            roomId: { type: "string", isRequirement: true, default: null },
        });

        if (errorMsg.length) {
            return resultError(errorMsg, false);
        }
    }

    console.log("gameStart!! #2");
    try {
        const promiseDocGamer = collection("gamers").doc(auth.uid).get();
        const promiseDocRoom = collection("game-rooms").doc(data.roomId).get();
        const promiseRoomGamers = collection("game-rooms")
            .doc(data.roomId)
            .collection("gamers")
            .get();
        const promiseRoomGamersChoose = collection("game-rooms")
            .doc(data.roomId)
            .collection("room-gamers-choose")
            .get();

        console.log("gameStart!! #3");
        const result = await Promise.all([
            promiseDocGamer,
            promiseDocRoom,
            promiseRoomGamers,
            promiseRoomGamersChoose,
        ]).then(
            async ([
                docGamer,
                docRoom,
                qsRoomGamers,
                qsRoomGamersChoose,
            ]): Promise<Result> => {
                console.log("gameStart!! #4");
                // 二次驗證
                {
                    if (!docRoom.exists) {
                        return resultError("不存在的房間", false);
                    }

                    if (
                        !docGamer.exists ||
                        qsRoomGamers.docs.length === 0 ||
                        qsRoomGamersChoose.docs.length === 0
                    ) {
                        return resultError("發生異常, 請重新登入! #1", false);
                    }
                }

                console.log("gameStart!! #5");
                /** 由 uid 取得的真正使用者資訊 */
                const dataGamer = docGamer.data() as GamerDoc;
                /** 由 客戶端 roomId 取得的 房間資訊 */
                const dataRoom = docRoom.data() as Room;

                console.log("gameStart!! #6");
                // 二次驗證
                {
                    if (
                        typeof dataGamer === "undefined" ||
                        typeof dataRoom === "undefined"
                    ) {
                        return resultError("發生異常, 請重新登入! #2", false);
                    }

                    /** 非等待不行開始遊戲 */
                    if (dataRoom.state !== roomStateMap.Waiting) {
                        return resultError("非等待不行開始遊戲! #3", false);
                    }

                    /** 當玩家所加入的房間 不是此 房間 */
                    if (dataGamer["join-game-room-id"] !== data.roomId) {
                        return resultError("發生異常, 請重新登入! #4", false);
                    }

                    /** 當玩家所加入的房間 不是此 房間 */
                    if (dataGamer.email !== dataRoom.roomMaster) {
                        return resultError("非房主不得開始遊戲! #5", false);
                    }

                    if (
                        gameConditionAllowArr.indexOf(
                            dataRoom.gameConditionKey
                        ) === -1
                    ) {
                        return resultError("無效的遊玩方式! #6", false);
                    }
                }

                console.log("gameStart!! #7");
                const dataRoomGamers = {} as RoomGamers;
                const dataRoomGamersChoose = {} as RoomGamerChooses;
                qsRoomGamers.forEach((docRoomGamer) => {
                    dataRoomGamers[
                        docRoomGamer.id
                    ] = docRoomGamer.data() as RoomGamer;
                });
                qsRoomGamersChoose.forEach((docRoomGamerChoose) => {
                    dataRoomGamersChoose[
                        docRoomGamerChoose.id
                    ] = docRoomGamerChoose.data() as RoomGamerChoose;
                });

                console.log("gameStart!! #8");
                /** 玩家選的選項 且不重複 */
                const gamerChooses = [];
                // 二次驗證 & 順便將 prevChoose 設置為 nowChoose & nowChoose 清空 & ready = false
                {
                    console.log("gameStart!! #9");
                    if (
                        dataRoom.gameConditionKey === gameConditionMap.cB &&
                        dataRoom.gameConditionValue >=
                            Object.keys(dataRoomGamers).length
                    ) {
                        return resultError(
                            `由於遊玩條件 玩家必須要大於 獲勝人數! #7 玩家人數:${
                                Object.keys(dataRoomGamers).length
                            } 遊戲條件人數:${dataRoom.gameConditionValue}`,
                            false
                        );
                    }

                    console.log("gameStart!! #10");
                    for (const [email, roomGamer] of Object.entries(
                        dataRoomGamers
                    )) {
                        if (!roomGamer.ready) {
                            return resultError("尚有玩家未準備! #8", false);
                        }

                        if (dataRoomGamersChoose[email].nowChoose === "") {
                            return resultError("尚有玩家未猜猜拳! #9", false);
                        }

                        if (
                            rpsAllowArr.indexOf(
                                dataRoomGamersChoose[email].nowChoose
                            ) === -1
                        ) {
                            return resultError(
                                "有未預期的猜猜拳! #10",
                                dataRoomGamersChoose[email].nowChoose
                            );
                        }

                        console.log("gameStart!! #11");
                        if (
                            gamerChooses.indexOf(
                                dataRoomGamersChoose[email].nowChoose
                            ) === -1
                        ) {
                            gamerChooses.push(
                                dataRoomGamersChoose[email].nowChoose
                            );
                        }

                        dataRoomGamers[email].prevChoose =
                            dataRoomGamersChoose[email].nowChoose;
                        dataRoomGamers[email].ready = false;
                        dataRoomGamersChoose[email].nowChoose = "";
                    }
                }

                console.log("gameStart!! #12");
                // game start!!
                const promiseArray = [];

                /** 沒有結果 */
                if (gamerChooses.length != 2) {
                    console.log("gameStart!! #13");
                    // reset
                    promiseArray.push(
                        collection("game-rooms").doc(data.roomId).update({
                            state: roomStateMap.Start,
                        })
                    );

                    console.log("gameStart!! #14");
                    for (const [email] of Object.entries(dataRoomGamers)) {
                        promiseArray.push(
                            collection("game-rooms")
                                .doc(data.roomId)
                                .collection("gamers")
                                .doc(email)
                                .update(dataRoomGamers[email])
                        );
                        promiseArray.push(
                            collection("game-rooms")
                                .doc(data.roomId)
                                .collection("room-gamers-choose")
                                .doc(email)
                                .update(dataRoomGamersChoose[email])
                        );
                    }

                    console.log("gameStart!! #15");
                    const noResult = await Promise.all(promiseArray);
                    console.log("gameStart!! #16", noResult);
                    return resultOk(noResult);
                }

                console.log("gameStart!! #16");
                const mapRockPaperScissors =
                    mapAllRockPaperScissors[gamerChooses[0]][gamerChooses[1]];

                const tempWinnerEmails = [];
                const tempLoserEmails = [];

                console.log("gameStart!! #17");
                for (const [email, roomGamer] of Object.entries(
                    dataRoomGamers
                )) {
                    if (mapRockPaperScissors[roomGamer.prevChoose]) {
                        tempWinnerEmails.push(email);
                    } else {
                        tempLoserEmails.push(email);
                    }
                }

                /** cA : 依照獲勝場數, 選出最終獲得勝利的玩家  */
                /** cB : 希望最終剩下多少最終優勝者  */
                if (dataRoom.gameConditionKey === gameConditionMap.cA) {
                    console.log("gameStart!! #18");
                    if (dataRoom.gameConditionValue === 1) {
                        console.log("gameStart!! #19");
                        // 獲勝者獲勝 ,失敗者失敗 且 結束遊戲
                        tempWinnerEmails.forEach((email) => {
                            dataRoomGamers[email].ready = true;
                            dataRoomGamers[email].result =
                                gamerResultMap.Winner;
                            dataRoomGamers[email].score = 1;
                        });
                        tempLoserEmails.forEach((email) => {
                            dataRoomGamers[email].ready = true;
                            dataRoomGamers[email].result = gamerResultMap.Loser;
                        });
                        dataRoom.state = roomStateMap.End;
                    } else {
                        console.log("gameStart!! #20");
                        // 尚未分出勝負
                        tempWinnerEmails.forEach((email) => {
                            dataRoomGamers[email].score = 1;
                        });
                        dataRoom.state = roomStateMap.Start;
                    }
                } else if (dataRoom.gameConditionKey === gameConditionMap.cB) {
                    if (
                        dataRoom.gameConditionValue === tempWinnerEmails.length
                    ) {
                        console.log("gameStart!! #21");
                        // 獲勝者獲勝 ,失敗者失敗 且 結束遊戲
                        tempWinnerEmails.forEach((email) => {
                            dataRoomGamers[email].ready = true;
                            dataRoomGamers[email].result =
                                gamerResultMap.Winner;
                        });
                        tempLoserEmails.forEach((email) => {
                            dataRoomGamers[email].ready = true;
                            dataRoomGamers[email].result = gamerResultMap.Loser;
                        });

                        dataRoom.state = roomStateMap.End;
                    } else {
                        console.log("gameStart!! #22");
                        if (
                            dataRoom.gameConditionValue >
                            tempWinnerEmails.length
                        ) {
                            console.log("gameStart!! #23");
                            // 獲勝者獲勝
                            tempWinnerEmails.forEach((email) => {
                                dataRoomGamers[email].ready = true;
                                dataRoomGamers[email].result =
                                    gamerResultMap.Winner;
                            });
                        } else {
                            console.log("gameStart!! #24");
                            // 失敗者失敗
                            tempLoserEmails.forEach((email) => {
                                dataRoomGamers[email].ready = true;
                                dataRoomGamers[email].result =
                                    gamerResultMap.Loser;
                            });
                        }
                        dataRoom.state = roomStateMap.Start;
                    }
                }

                console.log("gameStart!! #25");
                for (const [email] of Object.entries(dataRoomGamers)) {
                    promiseArray.push(
                        collection("game-rooms")
                            .doc(data.roomId)
                            .collection("gamers")
                            .doc(email)
                            .update(dataRoomGamers[email])
                    );

                    promiseArray.push(
                        collection("game-rooms")
                            .doc(data.roomId)
                            .collection("room-gamers-choose")
                            .doc(email)
                            .update(dataRoomGamersChoose[email])
                    );
                }

                console.log("gameStart!! #26");
                promiseArray.push(
                    collection("game-rooms").doc(data.roomId).update(dataRoom)
                );

                const resultFinal = await Promise.all(promiseArray).then(
                    (...data) => {
                        return resultOk(data);
                    }
                );

                console.log("gameStart!! #27", resultFinal);
                return resultFinal;
            }
        );

        return result;
    } catch (error) {
        console.log("發生不可預料的錯誤!!", error);
        errorLog("發生不可預料的錯誤!", gameStart.name);
    }

    return resultError("開始 遊戲失敗!", false);
}); // gameStart()

export const gameReady = functions.https.onCall(async (data, context) => {
    const auth = authVerification(context);

    //  初始驗證
    {
        if (auth === false) {
            return resultError(errorNames.authErrorList.unauthenticated, false);
        }

        const errorMsg = verificationDataFields(data, {
            roomId: { type: "string", isRequirement: true, default: null },
            choose: { type: "string", isRequirement: true, default: null },
        });

        if (errorMsg.length) {
            return resultError(errorMsg, false);
        }

        if (rpsAllowArr.indexOf(data.choose) === -1) {
            return resultError(errorMsg, false);
        }
    }

    /** 由玩家 確認的選擇 */
    const gamerReadyChoose = data.choose as string;

    try {
        const promiseDocGamer = collection("gamers").doc(auth.uid).get();
        const promiseDocRoom = collection("game-rooms").doc(data.roomId).get();
        const promiseRoomGamers = collection("game-rooms")
            .doc(data.roomId)
            .collection("gamers")
            .get();
        const promiseRoomGamersChoose = collection("game-rooms")
            .doc(data.roomId)
            .collection("room-gamers-choose")
            .get();

        const result = await Promise.all([
            promiseDocGamer,
            promiseDocRoom,
            promiseRoomGamers,
            promiseRoomGamersChoose,
        ]).then(
            async ([
                docGamer,
                docRoom,
                qsRoomGamers,
                qsRoomGamersChoose,
            ]): Promise<Result> => {
                // 二次驗證
                {
                    if (!docRoom.exists) {
                        return resultError("不存在的房間", false);
                    }

                    if (
                        !docGamer.exists ||
                        qsRoomGamers.docs.length === 0 ||
                        qsRoomGamersChoose.docs.length === 0
                    ) {
                        return resultError("發生異常, 請重新登入! #1", false);
                    }
                }

                /** 由 uid 取得的真正使用者資訊 */
                const dataGamer = docGamer.data() as GamerDoc;
                /** 由 客戶端 roomId 取得的 房間資訊 */
                const dataRoom = docRoom.data() as Room;

                // 二次驗證
                {
                    if (
                        typeof dataGamer === "undefined" ||
                        typeof dataRoom === "undefined"
                    ) {
                        return resultError("發生異常, 請重新登入! #2", false);
                    }

                    /** 非等待不行開始遊戲 */
                    if (dataRoom.state === roomStateMap.End) {
                        return resultError(
                            "結束遊戲不用在 Ready 了! #3",
                            false
                        );
                    }

                    /** 當玩家所加入的房間 不是此 房間 */
                    if (dataGamer["join-game-room-id"] !== data.roomId) {
                        return resultError("發生異常, 請重新登入! #4", false);
                    }

                    if (
                        gameConditionAllowArr.indexOf(
                            dataRoom.gameConditionKey
                        ) === -1
                    ) {
                        return resultError("無效的遊玩方式! #6", false);
                    }
                }

                /** 已經獲勝的玩家數量, 用來 依照獲勝人數使用  */
                let prevWinner = 0;
                /** 會先過濾掉已經有結果的玩家 */
                const dataRoomGamers = {} as RoomGamers;
                const dataRoomGamersChoose = {} as RoomGamerChooses;
                qsRoomGamers.forEach((docRoomGamer) => {
                    const roomGamer = docRoomGamer.data() as RoomGamer;

                    if (roomGamer.result === gamerResultMap.Gaming) {
                        dataRoomGamers[
                            docRoomGamer.id
                        ] = docRoomGamer.data() as RoomGamer;
                    } else if (roomGamer.result === gamerResultMap.Winner) {
                        prevWinner += 1;
                    }
                });

                // 二次驗證
                {
                    if (dataRoomGamers[dataGamer.email].ready) {
                        return resultError(
                            "不能重複 Ready, 只有一次機會 #7",
                            false
                        );
                    }
                }

                qsRoomGamersChoose.forEach((docRoomGamerChoose) => {
                    dataRoomGamersChoose[
                        docRoomGamerChoose.id
                    ] = docRoomGamerChoose.data() as RoomGamerChoose;
                });

                /** 設定玩家 Ready & 選擇 */
                dataRoomGamersChoose[
                    dataGamer.email
                ].nowChoose = gamerReadyChoose;
                dataRoomGamers[dataGamer.email].ready = true;

                /** 如果等待時刻 直接回寫 選擇 跟 Ready */
                if (dataRoom.state === roomStateMap.Waiting) {
                    const promiseArray = [];

                    promiseArray.push(
                        collection("game-rooms")
                            .doc(data.roomId)
                            .collection("gamers")
                            .doc(dataGamer.email)
                            .update(dataRoomGamers[dataGamer.email])
                    );

                    promiseArray.push(
                        collection("game-rooms")
                            .doc(data.roomId)
                            .collection("room-gamers-choose")
                            .doc(dataGamer.email)
                            .update(dataRoomGamersChoose[dataGamer.email])
                    );

                    const waitingResult = await Promise.all(promiseArray);
                    return resultOk(waitingResult);
                }

                // 這邊開始 為 State === Start 需判斷自動開始
                {
                    /** 是否要開始遊戲 */
                    let gamerStart = true;
                    {
                        for (const [, roomGamer] of Object.entries(
                            dataRoomGamers
                        )) {
                            if (!roomGamer.ready) {
                                gamerStart = false;
                            }
                        }
                    }

                    /** 尚有玩家還未選擇 直接回寫 並回傳 */
                    if (!gamerStart) {
                        const promiseArray = [];
                        promiseArray.push(
                            collection("game-rooms")
                                .doc(data.roomId)
                                .collection("gamers")
                                .doc(dataGamer.email)
                                .update(dataRoomGamers[dataGamer.email])
                        );

                        promiseArray.push(
                            collection("game-rooms")
                                .doc(data.roomId)
                                .collection("room-gamers-choose")
                                .doc(dataGamer.email)
                                .update(dataRoomGamersChoose[dataGamer.email])
                        );

                        const waitingResult = await Promise.all(promiseArray);
                        return resultOk(waitingResult);
                    }
                }

                // 這邊開始 為判斷 需要 "自動開始"

                /** 玩家選的選項 且不重複 */
                const gamerChooses = [];

                // 將 prevChoose 設置為 nowChoose & nowChoose 清空 & ready = false
                {
                    for (const [email] of Object.entries(dataRoomGamers)) {
                        if (
                            gamerChooses.indexOf(
                                dataRoomGamersChoose[email].nowChoose
                            ) === -1
                        ) {
                            gamerChooses.push(
                                dataRoomGamersChoose[email].nowChoose
                            );
                        }

                        dataRoomGamers[email].prevChoose =
                            dataRoomGamersChoose[email].nowChoose;
                        dataRoomGamers[email].ready = false;
                        dataRoomGamersChoose[email].nowChoose = "";
                    }
                }

                // game start!!
                const promiseArray = [];

                /** 沒有結果 */
                if (gamerChooses.length != 2) {
                    // reset
                    promiseArray.push(
                        collection("game-rooms").doc(data.roomId).update({
                            state: roomStateMap.Start,
                        })
                    );

                    for (const [email] of Object.entries(dataRoomGamers)) {
                        promiseArray.push(
                            collection("game-rooms")
                                .doc(data.roomId)
                                .collection("gamers")
                                .doc(email)
                                .update(dataRoomGamers[email])
                        );
                        promiseArray.push(
                            collection("game-rooms")
                                .doc(data.roomId)
                                .collection("room-gamers-choose")
                                .doc(email)
                                .update(dataRoomGamersChoose[email])
                        );
                    }

                    const noResult = await Promise.all(promiseArray);
                    return resultOk(noResult);
                }

                const mapRockPaperScissors =
                    mapAllRockPaperScissors[gamerChooses[0]][gamerChooses[1]];

                const tempWinnerEmails = [];
                const tempLoserEmails = [];

                for (const [email, roomGamer] of Object.entries(
                    dataRoomGamers
                )) {
                    if (mapRockPaperScissors[roomGamer.prevChoose]) {
                        tempWinnerEmails.push(email);
                    } else {
                        tempLoserEmails.push(email);
                    }
                }

                /** cA : 依照獲勝場數, 選出最終獲得勝利的玩家  */
                /** cB : 希望最終剩下多少最終優勝者  */
                if (dataRoom.gameConditionKey === gameConditionMap.cA) {
                    let isEndGame = false;
                    const tempFinalWinnerEmails: string[] = [];
                    tempWinnerEmails.forEach((email) => {
                        dataRoomGamers[email].score += 1;

                        if (
                            dataRoomGamers[email].score >=
                            dataRoom.gameConditionValue
                        ) {
                            isEndGame = true;
                            tempFinalWinnerEmails.push(email);
                        } else {
                            tempLoserEmails.push(email);
                        }
                    });

                    /** 確認遊戲結束 設定獲勝者 與 失敗者 */
                    if (isEndGame) {
                        tempFinalWinnerEmails.forEach((email) => {
                            dataRoomGamers[email].ready = true;
                            dataRoomGamers[email].result =
                                gamerResultMap.Winner;
                        });

                        tempLoserEmails.forEach((email) => {
                            dataRoomGamers[email].ready = true;
                            dataRoomGamers[email].result = gamerResultMap.Loser;
                        });

                        dataRoom.state = roomStateMap.End;
                    }
                } else if (dataRoom.gameConditionKey === gameConditionMap.cB) {
                    if (
                        dataRoom.gameConditionValue ===
                        tempWinnerEmails.length + prevWinner
                    ) {
                        // 獲勝者獲勝 ,失敗者失敗 且 結束遊戲
                        tempWinnerEmails.forEach((email) => {
                            dataRoomGamers[email].ready = true;
                            dataRoomGamers[email].result =
                                gamerResultMap.Winner;
                        });
                        tempLoserEmails.forEach((email) => {
                            dataRoomGamers[email].ready = true;
                            dataRoomGamers[email].result = gamerResultMap.Loser;
                        });

                        dataRoom.state = roomStateMap.End;
                    } else {
                        if (
                            dataRoom.gameConditionValue >
                            tempWinnerEmails.length + prevWinner
                        ) {
                            // 獲勝者獲勝
                            tempWinnerEmails.forEach((email) => {
                                dataRoomGamers[email].ready = true;
                                dataRoomGamers[email].result =
                                    gamerResultMap.Winner;
                            });
                        } else {
                            // 失敗者失敗
                            tempLoserEmails.forEach((email) => {
                                dataRoomGamers[email].ready = true;
                                dataRoomGamers[email].result =
                                    gamerResultMap.Loser;
                            });
                        }
                    }
                }

                for (const [email] of Object.entries(dataRoomGamers)) {
                    promiseArray.push(
                        collection("game-rooms")
                            .doc(data.roomId)
                            .collection("gamers")
                            .doc(email)
                            .update(dataRoomGamers[email])
                    );

                    promiseArray.push(
                        collection("game-rooms")
                            .doc(data.roomId)
                            .collection("room-gamers-choose")
                            .doc(email)
                            .update(dataRoomGamersChoose[email])
                    );
                }

                promiseArray.push(
                    collection("game-rooms").doc(data.roomId).update(dataRoom)
                );

                const resultFinal = await Promise.all(promiseArray).then(() => {
                    return resultOk(true);
                });

                return resultFinal;
            }
        );

        return result;
    } catch (error) {
        errorLog("發生不可預料的錯誤!", gameStart.name);
    }

    return resultError("開始 遊戲失敗!", false);
}); // gameReady()

// ===== Judge : END
