import { defineTool, type ToolDefinition } from '@copilotkit/runtime/v2';
import { z } from 'zod';
import type { WorkspaceStore } from './workspace.js';
import { ProjectError, validateFiles } from './projects.js';

const fileSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .max(300)
      .describe('Relative path, for example src/App.tsx or index.html'),
    content: z.string().max(100000).describe('Full file contents'),
  })
  .strict();

const templateSchema = z
  .enum(['static', 'react-vite', 'node-api'])
  .describe(
    'Project shape. static: plain HTML/CSS/JS. react-vite: Vite + React app. node-api: a small Node HTTP service.',
  );

// Website and app development tools. Files are stored as text and downloaded as
// a ZIP; the server never runs generated code.
export function projectTools(
  workspace: WorkspaceStore,
  dotId: string,
  check: () => void,
): ToolDefinition[] {
  return [
    defineTool({
      name: 'list_projects',
      description:
        'List web or app projects created in this workspace, newest first.',
      parameters: z.object({}).strict(),
      execute: async () => {
        check();
        return workspace.projects.list();
      },
    }),
    defineTool({
      name: 'create_project',
      description:
        'Create a downloadable web or app project from a set of files. Provide complete, runnable file contents. Returns a link the owner can open to preview and download.',
      parameters: z
        .object({
          name: z.string().trim().min(1).max(120),
          description: z.string().trim().max(500).default(''),
          template: templateSchema,
          files: z.array(fileSchema).min(1).max(200),
        })
        .strict(),
      execute: async ({ name, description, template, files }) => {
        check();
        try {
          const project = workspace.projects.create({
            dotId,
            name,
            description,
            template,
            files: validateFiles(files),
          });
          workspace.analytics.record({
            kind: 'project_created',
            dotId,
            refId: project.id,
            meta: { template, files: project.files.length },
          });
          return {
            id: project.id,
            name: project.name,
            files: project.files.map((file) => file.path),
            previewPath: `#/projects/${project.id}`,
          };
        } catch (error) {
          if (error instanceof ProjectError)
            throw new Error(error.message, { cause: error });
          throw error;
        }
      },
    }),
    defineTool({
      name: 'update_project',
      description:
        'Replace the files of an existing project. Provide the full file set you want the project to have.',
      parameters: z
        .object({
          projectId: z.string().min(1).max(100),
          name: z.string().trim().min(1).max(120).optional(),
          description: z.string().trim().max(500).optional(),
          files: z.array(fileSchema).min(1).max(200),
        })
        .strict(),
      execute: async ({ projectId, name, description, files }) => {
        check();
        try {
          const project = workspace.projects.update(projectId, {
            name,
            description,
            files: validateFiles(files),
          });
          return {
            id: project.id,
            name: project.name,
            files: project.files.map((file) => file.path),
            previewPath: `#/projects/${project.id}`,
          };
        } catch (error) {
          if (error instanceof ProjectError)
            throw new Error(error.message, { cause: error });
          throw error;
        }
      },
    }),
  ];
}
