-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "weekNumber" INTEGER,
    "dueBeforeLecture" DATETIME,
    "orderSource" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    CONSTRAINT "Topic_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Paper" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "authors" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "abstract" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "citationCount" INTEGER NOT NULL,
    "relevanceScore" REAL NOT NULL,
    "fullTextAvailable" BOOLEAN NOT NULL
);

-- CreateTable
CREATE TABLE "TopicPaper" (
    "topicId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("topicId", "paperId"),
    CONSTRAINT "TopicPaper_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TopicPaper_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "contentMarkdown" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourcePaperIds" TEXT NOT NULL,
    "essayPrompt" TEXT,
    "essayRubric" TEXT,
    CONSTRAINT "Module_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseModule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    CONSTRAINT "CourseModule_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseModule_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModuleChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" TEXT NOT NULL,
    CONSTRAINT "ModuleChunk_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Excerpt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    CONSTRAINT "Excerpt_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Excerpt_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModuleVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentMarkdown" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changeNote" TEXT,
    CONSTRAINT "ModuleVersion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QASession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "messages" TEXT NOT NULL,
    CONSTRAINT "QASession_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "questionType" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "studentAnswer" TEXT,
    "rubric" TEXT,
    "aiFeedback" TEXT,
    "score" REAL,
    "grounded" BOOLEAN,
    CONSTRAINT "Assessment_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssessmentAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "questionType" TEXT NOT NULL,
    "itemRef" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "response" TEXT,
    "score" REAL,
    "isCorrect" BOOLEAN,
    "confidence" INTEGER,
    "answeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledNextAt" DATETIME,
    CONSTRAINT "AssessmentAttempt_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssessmentAttempt_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionBankItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "moduleId" TEXT,
    "stem" TEXT NOT NULL,
    "options" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "explanation" TEXT,
    "author" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuestionBankItem_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RPSReconcile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "officialOrder" TEXT NOT NULL,
    "customOrder" TEXT NOT NULL,
    "diff" TEXT NOT NULL,
    CONSTRAINT "RPSReconcile_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AIUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT,
    "kind" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL,
    "tokensOut" INTEGER NOT NULL,
    "estimatedCost" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Course_name_key" ON "Course"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Paper_sourceUrl_key" ON "Paper"("sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Module_topicId_key" ON "Module"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseModule_courseId_moduleId_key" ON "CourseModule"("courseId", "moduleId");

