import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { TaskEngineService } from './task-engine.service';
import {
  CreateGoalDto,
  UpdateGoalDto,
  CreateTaskDto,
  UpdateTaskDto,
  AssignTaskDto,
  UpdateAssignmentDto,
  CarryForwardDto,
  UpdatePlanDto,
  ReorderDto,
  CreateNoteDto,
} from './dto/task-engine.dto';

// ─── Weekly plan ──────────────────────────────────────────────────────────────
// GET /api/task-engine/week?participantId=&week=YYYY-MM-DD
// Returns the full week structure (getOrCreate semantics).

@Controller('task-engine')
export class TaskEngineController {
  constructor(private readonly svc: TaskEngineService) {}

  // GET /api/task-engine/week?participantId=&week=YYYY-MM-DD
  @Get('week')
  getWeek(
    @Query('participantId') participantId: string,
    @Query('week') week: string,
  ) {
    return this.svc.getOrCreateWeekPlan(participantId, week);
  }

  @Patch('plans/:planId')
  updatePlan(@Param('planId') planId: string, @Body() dto: UpdatePlanDto) {
    return this.svc.updatePlan(planId, dto);
  }

  // ─── Goals ─────────────────────────────────────────────────────────────────

  @Post('plans/:planId/goals')
  createGoal(@Param('planId') planId: string, @Body() dto: CreateGoalDto) {
    return this.svc.createGoal(planId, dto);
  }

  @Patch('goals/:goalId')
  updateGoal(@Param('goalId') goalId: string, @Body() dto: UpdateGoalDto) {
    return this.svc.updateGoal(goalId, dto);
  }

  @Delete('goals/:goalId')
  deleteGoal(@Param('goalId') goalId: string) {
    return this.svc.deleteGoal(goalId);
  }

  @Post('plans/:planId/goals/reorder')
  reorderGoals(@Param('planId') planId: string, @Body() dto: ReorderDto) {
    return this.svc.reorderGoals(planId, dto.items);
  }

  // ─── Tasks ─────────────────────────────────────────────────────────────────

  @Post('plans/:planId/tasks')
  createTask(
    @Param('planId') planId: string,
    @Query('participantId') participantId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.svc.createTask(planId, participantId, dto);
  }

  @Patch('tasks/:taskId')
  updateTask(@Param('taskId') taskId: string, @Body() dto: UpdateTaskDto) {
    return this.svc.updateTask(taskId, dto);
  }

  @Delete('tasks/:taskId')
  deleteTask(@Param('taskId') taskId: string) {
    return this.svc.deleteTask(taskId);
  }

  @Post('plans/:planId/tasks/reorder')
  reorderTasks(@Param('planId') planId: string, @Body() dto: ReorderDto) {
    return this.svc.reorderTasks(planId, dto.items);
  }

  // ─── Assignments ───────────────────────────────────────────────────────────

  @Post('tasks/:taskId/assign')
  assignTask(@Param('taskId') taskId: string, @Body() dto: AssignTaskDto) {
    return this.svc.assignTask(taskId, dto);
  }

  @Patch('assignments/:id')
  updateAssignment(@Param('id') id: string, @Body() dto: UpdateAssignmentDto) {
    return this.svc.updateAssignment(id, dto);
  }

  @Delete('assignments/:id')
  removeAssignment(@Param('id') id: string) {
    return this.svc.removeAssignment(id);
  }

  @Post('assignments/:id/carry')
  carryForward(@Param('id') id: string, @Body() dto: CarryForwardDto) {
    return this.svc.carryForward(id, dto);
  }

  // ─── Daily view ────────────────────────────────────────────────────────────

  // GET /api/task-engine/day?participantId=&date=YYYY-MM-DD
  @Get('day')
  getDayAssignments(
    @Query('participantId') participantId: string,
    @Query('date') date: string,
  ) {
    return this.svc.getDayAssignments(participantId, date);
  }

  // GET /api/task-engine/daily-summary?participantId=&date=YYYY-MM-DD
  @Get('daily-summary')
  getDailySummary(
    @Query('participantId') participantId: string,
    @Query('date') date: string,
  ) {
    return this.svc.getDailySummary(participantId, date);
  }

  // GET /api/task-engine/weekly-summary?planId=
  @Get('weekly-summary')
  getWeeklySummary(@Query('planId') planId: string) {
    return this.svc.getWeeklySummary(planId);
  }

  // ─── Portal ────────────────────────────────────────────────────────────────
  // GET /api/task-engine/portal/:token  — resolve token to participant context
  @Get('portal/:token')
  resolvePortalToken(@Param('token') token: string) {
    return this.svc.resolvePortalToken(token);
  }

  // ─── Notes (coach ↔ participant chat) ──────────────────────────────────────
  // GET /api/task-engine/notes?participantId=
  @Get('notes')
  getNotes(@Query('participantId') participantId: string) {
    return this.svc.getNotes(participantId);
  }

  // POST /api/task-engine/notes
  @Post('notes')
  createNote(@Body() dto: CreateNoteDto) {
    return this.svc.createNote(dto);
  }
}
