import { Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { Access } from '../auth/guard';
import { Documents } from './documents.service';

@Controller()
export class DocumentsController {
  constructor(private d: Documents) {}
  // The photo itself is the request body (Content-Type image/jpeg, image/png or image/webp), up to 6 MB.
  @Access('account') @Post('upload_document') @HttpCode(200)
  upload(@Req() r: any, @Query('kind') kind: string) { return this.d.upload(r.who.accountId, r.ip, kind, r.body); }

  @Access('staff') @Get('get_document')
  async get(@Req() r: any, @Query('id') id: string, @Res() res: any) {
    const data = await this.d.readForStaff(r.staff.id, id);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', 'inline; filename="document.jpg"');
    res.send(data);
  }
}
