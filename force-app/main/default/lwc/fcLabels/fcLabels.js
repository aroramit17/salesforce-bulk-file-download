import Fc_Title from '@salesforce/label/c.Fc_Title';
import Fc_Loading from '@salesforce/label/c.Fc_Loading';
import Fc_Engine_Wait from '@salesforce/label/c.Fc_Engine_Wait';
import Fc_Include from '@salesforce/label/c.Fc_Include';
import Fc_Files from '@salesforce/label/c.Fc_Files';
import Fc_Attachments from '@salesforce/label/c.Fc_Attachments';
import Fc_Notes from '@salesforce/label/c.Fc_Notes';
import Fc_Enhanced_Notes from '@salesforce/label/c.Fc_Enhanced_Notes';
import Fc_File_Types from '@salesforce/label/c.Fc_File_Types';
import Fc_All_Types from '@salesforce/label/c.Fc_All_Types';
import Fc_Type_Pdf from '@salesforce/label/c.Fc_Type_Pdf';
import Fc_Type_Images from '@salesforce/label/c.Fc_Type_Images';
import Fc_Type_Office from '@salesforce/label/c.Fc_Type_Office';
import Fc_Size_Cap from '@salesforce/label/c.Fc_Size_Cap';
import Fc_No_Limit from '@salesforce/label/c.Fc_No_Limit';
import Fc_Created_From from '@salesforce/label/c.Fc_Created_From';
import Fc_Created_To from '@salesforce/label/c.Fc_Created_To';
import Fc_Layout from '@salesforce/label/c.Fc_Layout';
import Fc_Layout_Record from '@salesforce/label/c.Fc_Layout_Record';
import Fc_Layout_Object from '@salesforce/label/c.Fc_Layout_Object';
import Fc_Layout_Flat from '@salesforce/label/c.Fc_Layout_Flat';
import Fc_Pattern from '@salesforce/label/c.Fc_Pattern';
import Fc_Pattern_Help from '@salesforce/label/c.Fc_Pattern_Help';
import Fc_Latest_Only from '@salesforce/label/c.Fc_Latest_Only';
import Fc_Preview from '@salesforce/label/c.Fc_Preview';
import Fc_Count_Files from '@salesforce/label/c.Fc_Count_Files';
import Fc_Total_Size from '@salesforce/label/c.Fc_Total_Size';
import Fc_Parts_Notice from '@salesforce/label/c.Fc_Parts_Notice';
import Fc_Oversized_Notice from '@salesforce/label/c.Fc_Oversized_Notice';
import Fc_Access_Note from '@salesforce/label/c.Fc_Access_Note';
import Fc_No_Files from '@salesforce/label/c.Fc_No_Files';
import Fc_No_Records from '@salesforce/label/c.Fc_No_Records';
import Fc_Download from '@salesforce/label/c.Fc_Download';
import Fc_Cancel from '@salesforce/label/c.Fc_Cancel';
import Fc_More_Options from '@salesforce/label/c.Fc_More_Options';
import Fc_Fewer_Options from '@salesforce/label/c.Fc_Fewer_Options';
import Fc_Building from '@salesforce/label/c.Fc_Building';
import Fc_Keep_Open from '@salesforce/label/c.Fc_Keep_Open';
import Fc_Progress from '@salesforce/label/c.Fc_Progress';
import Fc_Progress_Bytes from '@salesforce/label/c.Fc_Progress_Bytes';
import Fc_Saved from '@salesforce/label/c.Fc_Saved';
import Fc_Done from '@salesforce/label/c.Fc_Done';
import Fc_Done_Failed from '@salesforce/label/c.Fc_Done_Failed';
import Fc_Cancelled from '@salesforce/label/c.Fc_Cancelled';
import Fc_Auth_Error from '@salesforce/label/c.Fc_Auth_Error';
import Fc_Error from '@salesforce/label/c.Fc_Error';
import Fc_Start_Over from '@salesforce/label/c.Fc_Start_Over';
import Fc_Object from '@salesforce/label/c.Fc_Object';
import Fc_List_View from '@salesforce/label/c.Fc_List_View';
import Fc_Pick_Object from '@salesforce/label/c.Fc_Pick_Object';
import Fc_Pick_List_View from '@salesforce/label/c.Fc_Pick_List_View';
import Fc_Tab_Intro from '@salesforce/label/c.Fc_Tab_Intro';
import Fc_Records_Found from '@salesforce/label/c.Fc_Records_Found';

// Every piece of user-facing text, keyed without the Fc_ prefix.
export const LABELS = {
    Title: Fc_Title,
    Loading: Fc_Loading,
    Engine_Wait: Fc_Engine_Wait,
    Include: Fc_Include,
    Files: Fc_Files,
    Attachments: Fc_Attachments,
    Notes: Fc_Notes,
    Enhanced_Notes: Fc_Enhanced_Notes,
    File_Types: Fc_File_Types,
    All_Types: Fc_All_Types,
    Type_Pdf: Fc_Type_Pdf,
    Type_Images: Fc_Type_Images,
    Type_Office: Fc_Type_Office,
    Size_Cap: Fc_Size_Cap,
    No_Limit: Fc_No_Limit,
    Created_From: Fc_Created_From,
    Created_To: Fc_Created_To,
    Layout: Fc_Layout,
    Layout_Record: Fc_Layout_Record,
    Layout_Object: Fc_Layout_Object,
    Layout_Flat: Fc_Layout_Flat,
    Pattern: Fc_Pattern,
    Pattern_Help: Fc_Pattern_Help,
    Latest_Only: Fc_Latest_Only,
    Preview: Fc_Preview,
    Count_Files: Fc_Count_Files,
    Total_Size: Fc_Total_Size,
    Parts_Notice: Fc_Parts_Notice,
    Oversized_Notice: Fc_Oversized_Notice,
    Access_Note: Fc_Access_Note,
    No_Files: Fc_No_Files,
    No_Records: Fc_No_Records,
    Download: Fc_Download,
    Cancel: Fc_Cancel,
    More_Options: Fc_More_Options,
    Fewer_Options: Fc_Fewer_Options,
    Building: Fc_Building,
    Keep_Open: Fc_Keep_Open,
    Progress: Fc_Progress,
    Progress_Bytes: Fc_Progress_Bytes,
    Saved: Fc_Saved,
    Done: Fc_Done,
    Done_Failed: Fc_Done_Failed,
    Cancelled: Fc_Cancelled,
    Auth_Error: Fc_Auth_Error,
    Error: Fc_Error,
    Start_Over: Fc_Start_Over,
    Object: Fc_Object,
    List_View: Fc_List_View,
    Pick_Object: Fc_Pick_Object,
    Pick_List_View: Fc_Pick_List_View,
    Tab_Intro: Fc_Tab_Intro,
    Records_Found: Fc_Records_Found,
};

/** Fills {0}, {1}... placeholders in a label. */
export function fmt(label, ...args) {
    return String(label).replace(/\{(\d+)\}/g, (m, i) => (args[i] === undefined ? m : args[i]));
}
