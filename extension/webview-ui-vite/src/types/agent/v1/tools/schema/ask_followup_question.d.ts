import { z } from "zod";
/**
 * @tool ask_followup_question
 * @description Ask the user a question to gather additional information needed to complete the task. This tool should be used when you encounter ambiguities, need clarification, or require more details to proceed effectively. It allows for interactive problem-solving by enabling direct communication with the user. Use this tool judiciously to maintain a balance between gathering necessary information and avoiding excessive back-and-forth.
 * @schema
 * {
 *   question: string; // The question to ask the user.
 * }
 * @example
 * ```xml
 * <tool name="ask_followup_question">
 *   <question>Could you please provide more details about the desired functionality?</question>
 * </tool>
 * ```
 * @example
 * ```xml
 * <tool name="ask_followup_question">
 *   <question>What is the deadline for this task?</question>
 * </tool>
 * ```
 * @example
 * ```xml
 * <tool name="ask_followup_question">
 *   <question>Do you have any preferred programming languages for this project?</question>
 * </tool>
 * ```
 */
declare const schema: z.ZodObject<{
    question: z.ZodString;
}, "strip", z.ZodTypeAny, {
    question: string;
}, {
    question: string;
}>;
export declare const askFollowupQuestionTool: {
    schema: {
        name: string;
        schema: z.ZodObject<{
            question: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            question: string;
        }, {
            question: string;
        }>;
    };
    examples: string[];
};
export type AskFollowupQuestionToolParams = {
    name: "ask_followup_question";
    input: z.infer<typeof schema>;
};
export {};
