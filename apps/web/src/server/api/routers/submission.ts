import type {
  Attachment,
  EnrolledUsers,
  Point,
  User,
  submission,
} from "@prisma/client";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { db } from "@/server/db";
import type { InputJsonValue } from "@prisma/client/runtime/library";

export interface AssignmentDetails {
  id: string;
  maxSubmissions: number;
  class: {
    courseId: string;
  };
}

export interface MentorDetails {
  mentor: {
    username: string;
  };
}

interface SubmissionWithDetails extends submission {
  enrolledUser: EnrolledUsers & {
    user: User;
  };
  points: Point[];
  assignment: Attachment;
  submissionCount?: number;
  submissionIndex?: number;
}

export const submissionRouter = createTRPCRouter({
  createSubmission: protectedProcedure
    .input(
      z.object({
        assignmentDetails: z.object({
          id: z.string(),
          maxSubmissions: z.number(),
          class: z.object({
            courseId: z.string(),
          }),
        }),
        files: z.any(),
        mentorDetails: z.object({
          mentor: z.object({
            username: z.string(),
          }),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session?.user;
      if (!user) {
        return { error: "unauthorized" };
      }

      const submissions = await db.submission.findMany({
        where: {
          attachmentId: input.assignmentDetails.id,
          enrolledUser: {
            username: user.username,
          },
        },
      });

      if (submissions.length >= input.assignmentDetails.maxSubmissions) {
        return { error: "Maximum submission limit reached" };
      }

      const enrolledUser = await db.enrolledUsers.findUnique({
        where: {
          username_courseId_mentorUsername: {
            username: user.username,
            courseId: input.assignmentDetails.class.courseId,
            mentorUsername: input.mentorDetails.mentor.username,
          },
        },
      });
      if (!enrolledUser) return { error: "Not enrolled" };

      const submission = await db.submission.create({
        data: {
          attachmentId: input.assignmentDetails.id,
          enrolledUserId: enrolledUser.id,
          data: input.files as unknown as InputJsonValue,
        },
      });

      await db.events.create({
        data: {
          eventCategory: "ASSIGNMENT_SUBMISSION",
          causedById: user.id,
          eventCategoryDataId: submission.id,
        },
      });

      return { success: true, data: submission };
    }),

  addOverallFeedback: protectedProcedure
    .input(
      z.object({
        submissionId: z.string(),
        feedback: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session?.user;
      if (!user) {
        return { error: "unauthorized" };
      }

      const submission = await db.submission.findUnique({
        where: {
          id: input.submissionId,
        },
      });

      if (!submission) {
        return { error: "submission not found" };
      }

      const updatedSubmission = await db.submission.update({
        where: {
          id: input.submissionId,
        },
        data: {
          overallFeedback: input.feedback,
        },
      });

      return { success: true, data: updatedSubmission };
    }),

  getAssignmentSubmissions: protectedProcedure
    .input(
      z.object({
        assignmentId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const user = ctx.session?.user;
      if (!user || user.role === "STUDENT") {
        return { error: "Unauthorized" };
      }

      const assignment = await db.attachment.findUnique({
        where: {
          id: input.assignmentId,
        },
      });

      const submissions = await db.submission.findMany({
        where: {
          attachmentId: input.assignmentId,
        },
        include: {
          enrolledUser: {
            include: {
              user: true,
            },
          },
          points: true,
          assignment: true,
        },
        orderBy: {
          enrolledUser: {
            username: "asc",
          },
        },
      });

      let filteredSubmissions: SubmissionWithDetails[] = [];

      if (user.role === "INSTRUCTOR") {
        filteredSubmissions = submissions as SubmissionWithDetails[];
      }

      if (user.role === "MENTOR") {
        filteredSubmissions = submissions.filter(
          (submission) =>
            submission.enrolledUser.mentorUsername === user.username,
        ) as SubmissionWithDetails[];
      }

      if (assignment?.maxSubmissions && assignment.maxSubmissions > 1) {
        const submissionCount = await db.submission.groupBy({
          by: ["enrolledUserId"],
          where: {
            attachmentId: input.assignmentId,
          },
          _count: {
            id: true,
          },
        });

        filteredSubmissions.forEach((submission) => {
          const submissionCountData = submissionCount.find(
            (data) => data.enrolledUserId === submission.enrolledUserId,
          );
          if (submissionCountData) {
            submission.submissionCount = submissionCountData._count.id;
          }
        });

        filteredSubmissions.forEach((submission) => {
          submission.submissionIndex = 1;
          if (submission.submissionCount && submission.submissionCount > 1) {
            const submissionIndex =
              submissions
                .filter(
                  (sub) => sub.enrolledUserId === submission.enrolledUserId,
                )
                .findIndex((sub) => sub.id === submission.id) ?? 0;
            submission.submissionIndex = submissionIndex + 1;
          }
        });
      }

      return { success: true, data: filteredSubmissions };
    }),

  getAllAssignmentSubmissions: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.session?.user;
    if (!user || user.role === "STUDENT") {
      return { error: "Unauthorized" };
    }

    const submissions = await db.submission.findMany({
      include: {
        enrolledUser: {
          include: {
            user: true,
          },
        },
        points: true,
        assignment: true,
      },
      orderBy: {
        enrolledUser: {
          username: "asc",
        },
      },
    });

    let filteredSubmissions: SubmissionWithDetails[] = [];

    if (user.role === "INSTRUCTOR") {
      filteredSubmissions = submissions as SubmissionWithDetails[];
    }

    if (user.role === "MENTOR") {
      filteredSubmissions = submissions.filter(
        (submission) =>
          submission.enrolledUser.mentorUsername === user.username,
      ) as SubmissionWithDetails[];
    }

    const submissionsByAssignment = filteredSubmissions.reduce(
      (acc, submission) => {
        acc[submission.attachmentId] ??= [];
        acc[submission.attachmentId]?.push(submission);
        return acc;
      },
      {} as Record<string, SubmissionWithDetails[]>,
    );

    for (const [attachmentId, assignmentSubmissions] of Object.entries(
      submissionsByAssignment,
    )) {
      const assignment = await db.attachment.findUnique({
        where: {
          id: attachmentId,
        },
      });

      if (assignment?.maxSubmissions && assignment.maxSubmissions > 1) {
        const submissionCount = await db.submission.groupBy({
          by: ["enrolledUserId"],
          where: {
            attachmentId: attachmentId,
          },
          _count: {
            id: true,
          },
        });

        assignmentSubmissions.forEach((submission) => {
          const submissionCountData = submissionCount.find(
            (data) => data.enrolledUserId === submission.enrolledUserId,
          );
          if (submissionCountData) {
            submission.submissionCount = submissionCountData._count.id;
          }
        });

        assignmentSubmissions.forEach((submission) => {
          submission.submissionIndex = 1;
          if (submission.submissionCount && submission.submissionCount > 1) {
            const submissionIndex =
              assignmentSubmissions
                .filter(
                  (sub) => sub.enrolledUserId === submission.enrolledUserId,
                )
                .findIndex((sub) => sub.id === submission.id) ?? 0;
            submission.submissionIndex = submissionIndex + 1;
          }
        });
      }
    }

    return { success: true, data: filteredSubmissions };
  }),

  getSubmissionById: protectedProcedure
    .input(
      z.object({
        submissionId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const user = ctx.session?.user;
      if (!user) {
        return { error: "Unauthorized" };
      }

      const submission = await db.submission.findUnique({
        where: {
          id: input.submissionId,
        },
        include: {
          enrolledUser: true,
          points: true,
        },
      });

      if (!submission && input.submissionId) {
        return { error: "Submission not found" };
      }

      return { success: true, data: submission };
    }),

  deleteSubmission: protectedProcedure
    .input(
      z.object({
        submissionId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session?.user;
      const haveAccess = user?.role === "INSTRUCTOR" || user?.role === "MENTOR";
      if (!user || !haveAccess) {
        return { error: "Unauthorized" };
      }

      await db.submission.delete({
        where: {
          id: input.submissionId,
        },
      });

      return { success: true };
    }),

  submitExternalLink: protectedProcedure
    .input(
      z.object({
        assignmentId: z.string(),
        maxSubmissions: z.number(),
        externalLink: z.string(),
        courseId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session?.user;
      if (!user) {
        return { error: "Unauthorized" };
      }

      const submissions = await db.submission.findMany({
        where: {
          attachmentId: input.assignmentId,
          enrolledUser: {
            username: user.username,
          },
        },
      });

      if (submissions.length >= input.maxSubmissions) {
        return { error: "Maximum submission limit reached" };
      }

      const mentorDetails = await db.enrolledUsers.findFirst({
        where: {
          username: user.username,
          courseId: input.courseId,
        },
        select: {
          mentor: {
            select: {
              username: true,
            },
          },
        },
      });

      if (!mentorDetails) {
        return { error: "Mentor not found" };
      }

      const enrolledUser = await db.enrolledUsers.findUnique({
        where: {
          username_courseId_mentorUsername: {
            username: user.username,
            courseId: input.courseId,
            mentorUsername: mentorDetails.mentor?.username ?? "",
          },
        },
      });

      if (!enrolledUser) {
        return { error: "User not enrolled in the course" };
      }

      await db.submission.create({
        data: {
          enrolledUserId: enrolledUser.id,
          attachmentId: input.assignmentId,
          submissionLink: input.externalLink,
        },
      });

      return { success: true };
    }),
});
