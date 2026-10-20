import * as fs from 'fs';
import * as path from 'path';

const repositoryRoot = path.resolve(__dirname, '..', '..');
const readManifest = (relativePath: string) =>
    JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8').replace(/^\uFEFF/, ''));

describe.each([
    {
        task: 'store-publish',
        id: '8e70da9d-532d-4416-a07f-5ec10f84339f',
        entryPoint: 'publishUi'
    },
    {
        task: 'store-flight',
        id: '13dee6a7-3698-4b12-bbb4-b393560a3ebc',
        entryPoint: 'flightUi'
    }
])('$task V0 execution handlers', ({ task, id, entryPoint }) => {
    const manifest = readManifest(path.join('tasks', `${task}-V1`, 'task.json'));

    test.each(['Node', 'Node10', 'Node16', 'Node20_1', 'Node24'])('%s uses the task entry point', handler => {
        expect(manifest.execution[handler]).toEqual({
            target: `local/${entryPoint}.js`,
            argumentFormat: ''
        });
    });

    test('preserves the task identity and entry point', () => {
        expect(manifest.id).toBe(id);
        expect(manifest.name).toBe(task);
        expect(fs.existsSync(path.join(repositoryRoot, 'tasks', `${task}-V1`, `${entryPoint}.ts`))).toBe(true);
    });
});
