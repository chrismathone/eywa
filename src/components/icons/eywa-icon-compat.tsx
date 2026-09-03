/**
 * 기존 화면의 아이콘 컴포넌트 호출 계약을 Eywa 도형으로 연결하는 호환 계층.
 *
 * 새 코드는 이 파일의 별칭 대신 `EyIcon name="…"`을 사용한다. 이 계층은 기존의
 * 크기·className·strokeWidth 전달과 동적 `LucideIcon` 타입을 유지하면서 외부
 * 아이콘 라이브러리 의존만 제거한다.
 */
import { EyIcon, type EywaIconName, type EywaIconProps } from "./eywa-icons";

type EywaCompatIconProps = Omit<EywaIconProps, "name"> & {
  absoluteStrokeWidth?: boolean;
};

const compatIconMap: Record<string, EywaIconName> = {};

function createEywaCompatIcon(name: EywaIconName, displayName: string) {
  compatIconMap[displayName] = name;

  function EywaCompatIcon({
    absoluteStrokeWidth = false,
    size,
    strokeWidth,
    ...props
  }: EywaCompatIconProps) {
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

  EywaCompatIcon.displayName = `Eywa${displayName}`;
  return EywaCompatIcon;
}

export type LucideIcon = ReturnType<typeof createEywaCompatIcon>;

export const Loader2 = createEywaCompatIcon("loader", "Loader2");
export const X = createEywaCompatIcon("close", "X");
export const Trash2 = createEywaCompatIcon("trash", "Trash2");
export const AlertCircle = createEywaCompatIcon("alertCircle", "AlertCircle");
export const Pencil = createEywaCompatIcon("edit", "Pencil");
export const Check = createEywaCompatIcon("check", "Check");
export const Save = createEywaCompatIcon("save", "Save");
export const Plus = createEywaCompatIcon("plus", "Plus");
export const ChevronDown = createEywaCompatIcon("chevronDown", "ChevronDown");
export const Sparkles = createEywaCompatIcon("sparkle", "Sparkles");
export const Users = createEywaCompatIcon("users", "Users");
export const AlertTriangle = createEywaCompatIcon("alert", "AlertTriangle");
export const Mic = createEywaCompatIcon("mic", "Mic");
export const ExternalLink = createEywaCompatIcon("externalLink", "ExternalLink");
export const Printer = createEywaCompatIcon("printer", "Printer");
export const ChevronRight = createEywaCompatIcon("chevronRight", "ChevronRight");
export const UserPlus = createEywaCompatIcon("userPlus", "UserPlus");
export const ArrowRight = createEywaCompatIcon("arrowRight", "ArrowRight");
export const BookOpen = createEywaCompatIcon("book", "BookOpen");
export const CalendarClock = createEywaCompatIcon("calendarClock", "CalendarClock");
export const RefreshCw = createEywaCompatIcon("sync", "RefreshCw");
export const Upload = createEywaCompatIcon("upload", "Upload");
export const CalendarDays = createEywaCompatIcon("calendar", "CalendarDays");
export const CheckCircle2 = createEywaCompatIcon("success", "CheckCircle2");
export const ChevronLeft = createEywaCompatIcon("chevronLeft", "ChevronLeft");
export const FileText = createEywaCompatIcon("report", "FileText");
export const UserMinus = createEywaCompatIcon("userMinus", "UserMinus");
export const Wallet = createEywaCompatIcon("wallet", "Wallet");
export const Download = createEywaCompatIcon("download", "Download");
export const History = createEywaCompatIcon("history", "History");
export const RotateCcw = createEywaCompatIcon("undo", "RotateCcw");
export const UserCheck = createEywaCompatIcon("userCheck", "UserCheck");
export const ChevronUp = createEywaCompatIcon("chevronUp", "ChevronUp");
export const ClipboardList = createEywaCompatIcon("clipboardList", "ClipboardList");
export const Clock = createEywaCompatIcon("clock", "Clock");
export const Copy = createEywaCompatIcon("copy", "Copy");
export const GraduationCap = createEywaCompatIcon("graduationCap", "GraduationCap");
export const User = createEywaCompatIcon("user", "User");
export const BookText = createEywaCompatIcon("bookText", "BookText");
export const CircleDollarSign = createEywaCompatIcon("currency", "CircleDollarSign");
export const ClipboardCheck = createEywaCompatIcon("clipboardCheck", "ClipboardCheck");
export const Eye = createEywaCompatIcon("eye", "Eye");
export const LayoutGrid = createEywaCompatIcon("layoutGrid", "LayoutGrid");
export const List = createEywaCompatIcon("list", "List");
export const MessageCircle = createEywaCompatIcon("message", "MessageCircle");
export const MessagesSquare = createEywaCompatIcon("messages", "MessagesSquare");
export const Pin = createEywaCompatIcon("pin", "Pin");
export const Sheet = createEywaCompatIcon("spreadsheet", "Sheet");
export const Square = createEywaCompatIcon("square", "Square");
export const ArrowLeft = createEywaCompatIcon("arrowLeft", "ArrowLeft");
export const Calculator = createEywaCompatIcon("calculator", "Calculator");
export const CalendarOff = createEywaCompatIcon("calendarOff", "CalendarOff");
export const CircleStop = createEywaCompatIcon("stop", "CircleStop");
export const Coins = createEywaCompatIcon("currency", "Coins");
export const FileSpreadsheet = createEywaCompatIcon("spreadsheet", "FileSpreadsheet");
export const Layers = createEywaCompatIcon("layers", "Layers");
export const LogOut = createEywaCompatIcon("logOut", "LogOut");
export const MapPin = createEywaCompatIcon("mapPin", "MapPin");
export const MessageSquare = createEywaCompatIcon("message", "MessageSquare");
export const Minus = createEywaCompatIcon("minus", "Minus");
export const PinOff = createEywaCompatIcon("pinOff", "PinOff");
export const QrCode = createEywaCompatIcon("qrCode", "QrCode");
export const Receipt = createEywaCompatIcon("receipt", "Receipt");
export const ReceiptText = createEywaCompatIcon("receipt", "ReceiptText");
export const ScrollText = createEywaCompatIcon("scrollText", "ScrollText");
export const Search = createEywaCompatIcon("search", "Search");
export const SearchX = createEywaCompatIcon("searchOff", "SearchX");
export const ShieldCheck = createEywaCompatIcon("shieldCheck", "ShieldCheck");
export const Tag = createEywaCompatIcon("tag", "Tag");
export const UserCog = createEywaCompatIcon("userSettings", "UserCog");
export const UserX = createEywaCompatIcon("userX", "UserX");
export const AlarmClock = createEywaCompatIcon("alarm", "AlarmClock");
export const AppWindow = createEywaCompatIcon("window", "AppWindow");
export const Archive = createEywaCompatIcon("archive", "Archive");
export const ArrowRightLeft = createEywaCompatIcon("swap", "ArrowRightLeft");
export const BadgePercent = createEywaCompatIcon("percentBadge", "BadgePercent");
export const Banknote = createEywaCompatIcon("banknote", "Banknote");
export const BarChart3 = createEywaCompatIcon("barChart", "BarChart3");
export const Bell = createEywaCompatIcon("bell", "Bell");
export const BellRing = createEywaCompatIcon("bellRing", "BellRing");
export const BookMarked = createEywaCompatIcon("bookMarked", "BookMarked");
export const Bus = createEywaCompatIcon("bus", "Bus");
export const Cake = createEywaCompatIcon("cake", "Cake");
export const Calendar = createEywaCompatIcon("calendar", "Calendar");
export const CalendarCheck = createEywaCompatIcon("calendarCheck", "CalendarCheck");
export const CheckCircle = createEywaCompatIcon("success", "CheckCircle");
export const CheckSquare = createEywaCompatIcon("checkbox", "CheckSquare");
export const Circle = createEywaCompatIcon("circle", "Circle");
export const Columns2 = createEywaCompatIcon("columns2", "Columns2");
export const Columns3 = createEywaCompatIcon("columns3", "Columns3");
export const CopyPlus = createEywaCompatIcon("copyPlus", "CopyPlus");
export const DoorOpen = createEywaCompatIcon("doorOpen", "DoorOpen");
export const Droplet = createEywaCompatIcon("droplet", "Droplet");
export const Eraser = createEywaCompatIcon("eraser", "Eraser");
export const File = createEywaCompatIcon("file", "File");
export const FileDown = createEywaCompatIcon("fileDownload", "FileDown");
export const FileImage = createEywaCompatIcon("image", "FileImage");
export const FilePlus2 = createEywaCompatIcon("filePlus", "FilePlus2");
export const Files = createEywaCompatIcon("files", "Files");
export const Filter = createEywaCompatIcon("filter", "Filter");
export const Folder = createEywaCompatIcon("folder", "Folder");
export const FolderOpen = createEywaCompatIcon("folderOpen", "FolderOpen");
export const GitMerge = createEywaCompatIcon("merge", "GitMerge");
export const Globe = createEywaCompatIcon("globe", "Globe");
export const GripVertical = createEywaCompatIcon("grip", "GripVertical");
export const Hash = createEywaCompatIcon("hash", "Hash");
export const HelpCircle = createEywaCompatIcon("help", "HelpCircle");
export const Home = createEywaCompatIcon("home", "Home");
export const ImageDown = createEywaCompatIcon("imageDownload", "ImageDown");
export const Info = createEywaCompatIcon("info", "Info");
export const KeyRound = createEywaCompatIcon("key", "KeyRound");
export const Languages = createEywaCompatIcon("languages", "Languages");
export const LayoutDashboard = createEywaCompatIcon("layoutGrid", "LayoutDashboard");
export const LayoutPanelTop = createEywaCompatIcon("panelTop", "LayoutPanelTop");
export const ListChecks = createEywaCompatIcon("listChecks", "ListChecks");
export const ListFilter = createEywaCompatIcon("filterList", "ListFilter");
export const LogIn = createEywaCompatIcon("logIn", "LogIn");
export const Mail = createEywaCompatIcon("mail", "Mail");
export const Megaphone = createEywaCompatIcon("megaphone", "Megaphone");
export const MessageSquareOff = createEywaCompatIcon("messageOff", "MessageSquareOff");
export const Palette = createEywaCompatIcon("palette", "Palette");
export const PanelLeftClose = createEywaCompatIcon("panelLeftClose", "PanelLeftClose");
export const PanelLeftOpen = createEywaCompatIcon("panelLeftOpen", "PanelLeftOpen");
export const Paperclip = createEywaCompatIcon("paperclip", "Paperclip");
export const Percent = createEywaCompatIcon("percent", "Percent");
export const PieChart = createEywaCompatIcon("pieChart", "PieChart");
export const Power = createEywaCompatIcon("power", "Power");
export const RotateCw = createEywaCompatIcon("sync", "RotateCw");
export const School = createEywaCompatIcon("building", "School");
export const Scissors = createEywaCompatIcon("scissors", "Scissors");
export const Send = createEywaCompatIcon("send", "Send");
export const Settings2 = createEywaCompatIcon("settings", "Settings2");
export const StickyNote = createEywaCompatIcon("note", "StickyNote");
export const Tags = createEywaCompatIcon("tags", "Tags");
export const Target = createEywaCompatIcon("target", "Target");
export const TrendingDown = createEywaCompatIcon("trendingDown", "TrendingDown");
export const TriangleAlert = createEywaCompatIcon("alert", "TriangleAlert");
export const UploadCloud = createEywaCompatIcon("cloudUpload", "UploadCloud");
export const Wrench = createEywaCompatIcon("wrench", "Wrench");
export const XCircle = createEywaCompatIcon("error", "XCircle");

/** 현재 코드베이스의 기존 컴포넌트 이름과 Eywa 도형 사이의 전수 매핑. */
export const EYWA_ICON_COMPAT_MAP = Object.freeze({ ...compatIconMap });
