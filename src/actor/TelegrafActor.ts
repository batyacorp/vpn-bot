import {Actor} from 'comedy'
import {Telegraf} from 'telegraf'
import * as tg from '../model/telegram-massege-types'
import {TelegramUserData} from '../model/vpn-user-types'
import {VpnL10n} from '../scenes/l10n/VpnL10n'
import {VpnL10nEn} from '../scenes/l10n/VpnL10nEn'
import {VpnL10nRu} from '../scenes/l10n/VpnL10nRu'
import * as mrk from '../scenes/scene-markup'
import fs from "fs";

export interface TelegrafActorProps {
    token: string
    channel: tg.Channel
}

export default class TelegrafActor {
    private l10nMap: { [lang: string]: VpnL10n } = {
        'en': new VpnL10nEn(),
        'ru': new VpnL10nRu()
    }

    private selfActor!: Actor
    private props!: TelegrafActorProps
    private telegraf!: Telegraf

    initialize(selfActor: Actor) {
        this.selfActor = selfActor
        this.props = selfActor.getCustomParameters()
        this.selfActor.getLog().info('init')
    }

    async destroy() {
        this.telegraf?.stop()
    }

    private l10n(telegramUser: TelegramUserData): VpnL10n {
        // const lang =
        //   telegramUser.languageCode != null
        //   && telegramUser.languageCode.toLowerCase().indexOf('ru') != -1
        //     ? 'ru': 'en'
        return this.l10nMap['ru']
    }

    async launch() {
        this.telegraf = new Telegraf(this.props.token)

        try {
            this.telegraf.on('text', async (ctx) => {
                const user = ctx.from
                const messageId = ctx.message.message_id
                const text = ctx.message.text
                const msg: tg.InboundTelegramMessage = {
                    channel: this.props.channel,
                    telegramUser: {
                        telegramUserId: user.id,
                        username: user.username,
                        firstName: user.first_name,
                        lastName: user.last_name,
                        languageCode: user.language_code
                    },
                    inputPayload: {tpe: 'TextInput', text, messageId}
                }
                await this.selfActor.getParent().send('processInboundTelegramMessage', msg)
            })
        } catch (ignore) {
        }

        this.telegraf.on('callback_query', async (ctx) => {
            try {
                await ctx.telegram.answerCbQuery(ctx.update.callback_query.id)
                const user = ctx.update.callback_query.from
                const messageId = ctx.callbackQuery.message?.message_id || 0
                const data: string = (<any>ctx.update.callback_query).data ?? ''
                const msg: tg.InboundTelegramMessage = {
                    channel: this.props.channel,
                    telegramUser: {
                        telegramUserId: user.id,
                        username: user.username,
                        firstName: user.first_name,
                        lastName: user.last_name,
                        languageCode: user.language_code
                    },
                    inputPayload: {tpe: 'CallbackInput', data, messageId}
                }
                await this.selfActor.getParent().send('processInboundTelegramMessage', msg)
            } catch (ignore) {
            }
        })

        await this.telegraf.launch()
    }

    async processOutboundTelegramMessage(msg: tg.OutboundTelegramMessage) {
        try {
            if (this.props.channel != msg.channel) return
            switch (msg.outputPayload.tpe) {
                case 'SendOutput': {
                    const scene = msg.outputPayload.scene
                    let l10n = this.l10n(msg.userData);
                    const text = l10n.getText(scene)
                    const messageId = await this.telegraf.telegram.sendMessage(msg.chatId, text, {
                        ...mrk.getMarkup(scene, l10n),
                        disable_web_page_preview: true,
                        parse_mode: 'Markdown',
                        disable_notification: true
                    })
                    msg.outputPayload.scene.messageId = messageId.message_id
                }
                    break

                case 'DeleteMessageOutput': {
                    await this.telegraf.telegram.deleteMessage(msg.chatId, msg.outputPayload.messageId)
                }
                    break

                case 'EditOutput': {
                    let l10n = this.l10n(msg.userData);
                    const messageId = msg.outputPayload.scene.messageId
                    const text = l10n.getText(msg.outputPayload.scene)
                    const scene = msg.outputPayload.scene
                    await this.telegraf.telegram.editMessageText(
                        msg.chatId, messageId, undefined, text, {
                            ...mrk.getMarkup(scene, l10n),
                            disable_web_page_preview: true,
                            parse_mode: 'Markdown'
                        })
                }
                    break

                case 'TextOutput':
                    await this.telegraf.telegram.sendMessage(
                        msg.chatId,
                        msg.outputPayload.text, {
                            disable_web_page_preview: true,
                            parse_mode: 'Markdown',
                            disable_notification: true
                        }
                    )
                    break

                case 'SendFile':
                    if (msg.outputPayload.scene.tpe == "GetConfigs") {
                        const mobileConfigData = msg.outputPayload.scene.mobileConfigData
                        const pcConfigData = msg.outputPayload.scene.pcConfigData
                        await fs.writeFileSync(`mobileConfig${msg.chatId}.ovpn`, mobileConfigData)
                        await fs.writeFileSync(`pcConfig${msg.chatId}.ovpn`, pcConfigData)
                        await this.telegraf.telegram.sendDocument(
                            msg.chatId, {
                                filename: `mobileConfig.ovpn`,
                                source: `./mobileConfig${msg.chatId}.ovpn`
                            },
                            {disable_notification: true}
                        )
                        await this.telegraf.telegram.sendDocument(
                            msg.chatId, {
                                filename: `pcConfig.ovpn`,
                                source: `./pcConfig${msg.chatId}.ovpn`
                            },
                            {disable_notification: true}
                        )
                        fs.unlink(`./mobileConfig${msg.chatId}.ovpn`, err => {
                        })
                        fs.unlink(`./pcConfig${msg.chatId}.ovpn`, err => {
                        })
                        await this.selfActor.getParent().send("processResendOutboundMessage",
                            msg)
                    }
                    const scene = msg.outputPayload.scene.tpe
                    if (scene == "IphoneInstruction" || scene == "MacInstruction" ||
                        scene == "AndroidInstruction" || scene == "WindowsInstruction"
                    ) {
                        await this.telegraf.telegram.sendVideo(
                            msg.chatId, {
                                filename: msg.outputPayload.scene.filename,
                                source: msg.outputPayload.scene.source,
                            }, {
                                disable_notification: true
                            }
                        )
                        await this.selfActor.getParent().send("processResendOutboundMessage",
                            msg)
                    }
                    break

                case 'SendAdminMassage':
                    if (msg.outputPayload.scene.tpe == "SendMassageToUser") {
                        const scene = msg.outputPayload.scene
                        let l10n = this.l10n(msg.userData);
                        const text = l10n.getText(scene)
                        await this.telegraf.telegram.sendMessage(
                            msg.chatId,
                            text, {
                                ...mrk.getMarkup(scene, l10n),
                                disable_web_page_preview: true,
                                parse_mode: 'Markdown',
                                disable_notification: false
                            }
                        )
                        break
                    }
            }
        } catch (ignore) {
        }
    }
}
