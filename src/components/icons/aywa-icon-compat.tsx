/**
 * 기존 화면의 아이콘 컴포넌트 호출 계약을 Aywa 도형으로 연결하는 호환 계층.
 *
 * 새 코드는 이 파일의 별칭 대신 `EyIcon name="…"`을 사용한다. 이 계층은 기존의
 * 크기·className·strokeWidth 전달과 동적 `LucideIcon` 타입을 유지하면서 외부
 * 아이콘 라이브러리 의존만 제거한다.
 */
import { EyIcon, type AywaIconName, type AywaIconProps } from "./aywa-icons";

type AywaCompatIconProps = Omit<AywaIconProps, "name"> & {
  absoluteStrokeWidth?: boolean;
};

const compatIconMap: Record<string, AywaIconName> = {};

function createAywaCompatIcon(name: AywaIconName, displayName: string) {
  compatIconMap[displayName] = name;

  function AywaCompatIcon({
    absoluteStrokeWidth = false,
    size,
    strokeWidth,
    ...props
  }: AywaCompatIconProps) {
    const adjustedStrokeWidth =
      absoluteStrokeWidth && typeof size === "number"
        ? ((strokeWidth ?? 1.6) * 24) / size
        : strokeWidth;

    return (
      <EyIcon
        {...props}
        name={name}
        size={size}
        strokeWidth={adjustedStrokeWidth}
      />
    );
  }

  AywaCompatIcon.displayName = `Aywa${displayName}`;
  return AywaCompatIcon;
}

export type LucideIcon = ReturnType<typeof createAywaCompatIcon>;

export const Loader2 = createAywaCompatIcon("loader", "Loader2");
export const X = createAywaCompatIcon("close", "X");
export const Trash2 = createAywaCompatIcon("trash", "Trash2");
export const AlertCircle = createAywaCompatIcon("alertCircle", "AlertCircle");
export const Pencil = createAywaCompatIcon("edit", "Pencil");
export const Check = createAywaCompatIcon("check", "Check");
export const Save = createAywaCompatIcon("save", "Save");
export const Plus = createAywaCompatIcon("plus", "Plus");
export const ChevronDown = createAywaCompatIcon("chevronDown", "ChevronDown");
export const Sparkles = createAywaCompatIcon("sparkle", "Sparkles");
export const Users = createAywaCompatIcon("users", "Users");
export const AlertTriangle = createAywaCompatIcon("alert", "AlertTriangle");
export const Mic = createAywaCompatIcon("mic", "Mic");
export const ExternalLink = createAywaCompatIcon("externalLink", "ExternalLink");
export const Printer = createAywaCompatIcon("printer", "Printer");
export const ChevronRight = createAywaCompatIcon("chevronRight", "ChevronRight");
export const UserPlus = createAywaCompatIcon("userPlus", "UserPlus");
export const ArrowRight = createAywaCompatIcon("arrowRight", "ArrowRight");
export const BookOpen = createAywaCompatIcon("book", "BookOpen");
export const CalendarClock = createAywaCompatIcon("calendarClock", "CalendarClock");
export const RefreshCw = createAywaCompatIcon("sync", "RefreshCw");
export const Upload = createAywaCompatIcon("upload", "Upload");
export const CalendarDays = createAywaCompatIcon("calendar", "CalendarDays");
export const CheckCircle2 = createAywaCompatIcon("success", "CheckCircle2");
export const ChevronLeft = createAywaCompatIcon("chevronLeft", "ChevronLeft");
export const FileText = createAywaCompatIcon("report", "FileText");
export const UserMinus = createAywaCompatIcon("userMinus", "UserMinus");
export const Wallet = createAywaCompatIcon("wallet", "Wallet");
export const Download = createAywaCompatIcon("download", "Download");
export const History = createAywaCompatIcon("history", "History");
export const RotateCcw = createAywaCompatIcon("undo", "RotateCcw");
export const UserCheck = createAywaCompatIcon("userCheck", "UserCheck");
export const ChevronUp = createAywaCompatIcon("chevronUp", "ChevronUp");
export const ClipboardList = createAywaCompatIcon("clipboardList", "ClipboardList");
export const Clock = createAywaCompatIcon("clock", "Clock");
export const Copy = createAywaCompatIcon("copy", "Copy");
export const GraduationCap = createAywaCompatIcon("graduationCap", "GraduationCap");
export const User = createAywaCompatIcon("user", "User");
export const BookText = createAywaCompatIcon("bookText", "BookText");
export const CircleDollarSign = createAywaCompatIcon("currency", "CircleDollarSign");
export const ClipboardCheck = createAywaCompatIcon("clipboardCheck", "ClipboardCheck");
export const Eye = createAywaCompatIcon("eye", "Eye");
export const LayoutGrid = createAywaCompatIcon("layoutGrid", "LayoutGrid");
export const List = createAywaCompatIcon("list", "List");
export const MessageCircle = createAywaCompatIcon("message", "MessageCircle");
export const MessagesSquare = createAywaCompatIcon("messages", "MessagesSquare");
export const Pin = createAywaCompatIcon("pin", "Pin");
export const Sheet = createAywaCompatIcon("spreadsheet", "Sheet");
export const Square = createAywaCompatIcon("square", "Square");
export const ArrowLeft = createAywaCompatIcon("arrowLeft", "ArrowLeft");
export const Calculator = createAywaCompatIcon("calculator", "Calculator");
export const CalendarOff = createAywaCompatIcon("calendarOff", "CalendarOff");
export const CircleStop = createAywaCompatIcon("stop", "CircleStop");
export const Coins = createAywaCompatIcon("currency", "Coins");
export const FileSpreadsheet = createAywaCompatIcon("spreadsheet", "FileSpreadsheet");
export const Layers = createAywaCompatIcon("layers", "Layers");
export const LogOut = createAywaCompatIcon("logOut", "LogOut");
export const MapPin = createAywaCompatIcon("mapPin", "MapPin");
export const MessageSquare = createAywaCompatIcon("message", "MessageSquare");
export const Minus = createAywaCompatIcon("minus", "Minus");
export const PinOff = createAywaCompatIcon("pinOff", "PinOff");
export const QrCode = createAywaCompatIcon("qrCode", "QrCode");
export const Receipt = createAywaCompatIcon("receipt", "Receipt");
export const ReceiptText = createAywaCompatIcon("receipt", "ReceiptText");
export const ScrollText = createAywaCompatIcon("scrollText", "ScrollText");
export const Search = createAywaCompatIcon("search", "Search");
export const SearchX = createAywaCompatIcon("searchOff", "SearchX");
export const ShieldCheck = createAywaCompatIcon("shieldCheck", "ShieldCheck");
export const Tag = createAywaCompatIcon("tag", "Tag");
export const UserCog = createAywaCompatIcon("userSettings", "UserCog");
export const UserX = createAywaCompatIcon("userX", "UserX");
export const AlarmClock = createAywaCompatIcon("alarm", "AlarmClock");
export const AppWindow = createAywaCompatIcon("window", "AppWindow");
export const Archive = createAywaCompatIcon("archive", "Archive");
export const ArrowRightLeft = createAywaCompatIcon("swap", "ArrowRightLeft");
export const BadgePercent = createAywaCompatIcon("percentBadge", "BadgePercent");
export const Banknote = createAywaCompatIcon("banknote", "Banknote");
export const Bell = createAywaCompatIcon("bell", "Bell");
export const BellRing = createAywaCompatIcon("bellRing", "BellRing");
export const BookMarked = createAywaCompatIcon("bookMarked", "BookMarked");
export const Bus = createAywaCompatIcon("bus", "Bus");
export const Cake = createAywaCompatIcon("cake", "Cake");
export const Calendar = createAywaCompatIcon("calendar", "Calendar");
export const CalendarCheck = createAywaCompatIcon("calendarCheck", "CalendarCheck");
export const CheckCircle = createAywaCompatIcon("success", "CheckCircle");
export const CheckSquare = createAywaCompatIcon("checkbox", "CheckSquare");
export const Circle = createAywaCompatIcon("circle", "Circle");
export const Columns2 = createAywaCompatIcon("columns2", "Columns2");
export const Columns3 = createAywaCompatIcon("columns3", "Columns3");
export const CopyPlus = createAywaCompatIcon("copyPlus", "CopyPlus");
export const DoorOpen = createAywaCompatIcon("doorOpen", "DoorOpen");
export const Droplet = createAywaCompatIcon("droplet", "Droplet");
export const Eraser = createAywaCompatIcon("eraser", "Eraser");
export const File = createAywaCompatIcon("file", "File");
export const FileDown = createAywaCompatIcon("fileDownload", "FileDown");
export const FileImage = createAywaCompatIcon("image", "FileImage");
export const FilePlus2 = createAywaCompatIcon("filePlus", "FilePlus2");
export const Files = createAywaCompatIcon("files", "Files");
export const Filter = createAywaCompatIcon("filter", "Filter");
export const Folder = createAywaCompatIcon("folder", "Folder");
export const FolderOpen = createAywaCompatIcon("folderOpen", "FolderOpen");
export const GitMerge = createAywaCompatIcon("merge", "GitMerge");
export const Globe = createAywaCompatIcon("globe", "Globe");
export const GripVertical = createAywaCompatIcon("grip", "GripVertical");
export const Hash = createAywaCompatIcon("hash", "Hash");
export const HelpCircle = createAywaCompatIcon("help", "HelpCircle");
export const Home = createAywaCompatIcon("home", "Home");
export const ImageDown = createAywaCompatIcon("imageDownload", "ImageDown");
export const Info = createAywaCompatIcon("info", "Info");
export const KeyRound = createAywaCompatIcon("key", "KeyRound");
export const Languages = createAywaCompatIcon("languages", "Languages");
export const LayoutPanelTop = createAywaCompatIcon("panelTop", "LayoutPanelTop");
export const ListChecks = createAywaCompatIcon("listChecks", "ListChecks");
export const ListFilter = createAywaCompatIcon("filterList", "ListFilter");
export const LogIn = createAywaCompatIcon("logIn", "LogIn");
export const Mail = createAywaCompatIcon("mail", "Mail");
export const Megaphone = createAywaCompatIcon("megaphone", "Megaphone");
export const MessageSquareOff = createAywaCompatIcon("messageOff", "MessageSquareOff");
export const Palette = createAywaCompatIcon("palette", "Palette");
export const PanelLeftClose = createAywaCompatIcon("panelLeftClose", "PanelLeftClose");
export const PanelLeftOpen = createAywaCompatIcon("panelLeftOpen", "PanelLeftOpen");
export const Paperclip = createAywaCompatIcon("paperclip", "Paperclip");
export const Percent = createAywaCompatIcon("percent", "Percent");
export const PieChart = createAywaCompatIcon("pieChart", "PieChart");
export const Power = createAywaCompatIcon("power", "Power");
export const RotateCw = createAywaCompatIcon("sync", "RotateCw");
export const School = createAywaCompatIcon("building", "School");
export const Scissors = createAywaCompatIcon("scissors", "Scissors");
export const Send = createAywaCompatIcon("send", "Send");
export const Settings2 = createAywaCompatIcon("settings", "Settings2");
export const StickyNote = createAywaCompatIcon("note", "StickyNote");
export const Tags = createAywaCompatIcon("tags", "Tags");
export const Target = createAywaCompatIcon("target", "Target");
export const TrendingDown = createAywaCompatIcon("trendingDown", "TrendingDown");
export const TriangleAlert = createAywaCompatIcon("alert", "TriangleAlert");
export const UploadCloud = createAywaCompatIcon("cloudUpload", "UploadCloud");
export const Wrench = createAywaCompatIcon("wrench", "Wrench");
export const XCircle = createAywaCompatIcon("error", "XCircle");

/** 현재 코드베이스의 기존 컴포넌트 이름과 Aywa 도형 사이의 전수 매핑. */
export const AYWA_ICON_COMPAT_MAP = Object.freeze({ ...compatIconMap });
