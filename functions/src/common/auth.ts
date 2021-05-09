import * as functions from "firebase-functions";

interface AuthVerification {
    uid: string;
}

export const authVerification = (
    context: functions.https.CallableContext
): AuthVerification | false => {
    if (!context.auth || !context.auth?.uid) {
        return false;
        // throw new functions.https.HttpsError(
        //     "unauthenticated",
        //     "未登入無法使用此API"
        // );
    }

    return { uid: context.auth.uid };
};

interface FieldTypes {
    [FieldName: string]: { type: string; isRequirement: boolean; default: any };
}

export const verificationDataFields = (
    data: any,
    fieldNames: FieldTypes
): string => {
    let errorMsg = "";
    for (const [fieldName, details] of Object.entries(fieldNames)) {
        if (typeof data[fieldName] !== details.type) {
            if (details.isRequirement) {
                errorMsg = `${
                    errorMsg.length ? `${errorMsg},` : null
                } ${fieldName} is requirement!`;

                continue;
            } else {
                data[fieldName] = details.default;
            }
        }
    }

    return errorMsg;
};
